use crate::{error::AppError, pinned_screenshot, translation::{self, OcrDocument, StoredTranslationConfig, TranslationOutput}};
use serde::Serialize;
use std::{collections::{HashMap, VecDeque}, sync::{atomic::{AtomicU64, Ordering}, Arc, Mutex}, time::{Duration, Instant}};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tokio::sync::{watch, Semaphore};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobSnapshot {
    pub id: String,
    pub status: String,
    pub error: Option<String>,
    pub document: Option<OcrDocument>,
    pub output: Option<TranslationOutput>,
}

struct Job {
    snapshot: JobSnapshot,
    config: StoredTranslationConfig,
    cancel: watch::Sender<bool>,
    started: Instant,
}

#[derive(Default)]
struct Jobs {
    items: HashMap<String, Job>,
    queue: VecDeque<String>,
    active: Option<String>,
}

pub struct TranslationJobs { jobs: Mutex<Jobs>, next_id: AtomicU64, network_slots: Arc<Semaphore> }
impl Default for TranslationJobs {
    fn default() -> Self {
        Self { jobs: Mutex::new(Jobs::default()), next_id: AtomicU64::new(1), network_slots: Arc::new(Semaphore::new(2)) }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrTask {
    pub id: String,
    pub image: String,
    pub source_language: String,
}

fn notify(app: &AppHandle, label: &str, snapshot: &JobSnapshot) {
    let _ = app.emit_to(label, "translation-updated", snapshot);
}

fn lock_error() -> AppError { AppError::Translation("翻译任务状态不可用。".into()) }

pub fn start(window: &WebviewWindow, config: StoredTranslationConfig) -> Result<JobSnapshot, AppError> {
    let app = window.app_handle();
    let label = window.label();
    pinned_screenshot::image_for_label(app, label)?;
    if !config.settings.consent { return Err(AppError::Validation("请先在设置中同意将识别文字发送到翻译服务。".into())); }
    if config.settings.provider == translation::TranslationProvider::Openai && config.api_key.is_empty() {
        return Err(AppError::Validation("请先在设置中配置独立的 OpenAI API Key。".into()));
    }
    let state = app.state::<TranslationJobs>();
    let mut jobs = state.jobs.lock().map_err(|_| lock_error())?;
    if jobs.items.get(label).is_some_and(|job| matches!(job.snapshot.status.as_str(), "queued" | "recognizing" | "translating")) {
        return Err(AppError::Validation("当前图片已有翻译任务。".into()));
    }
    let id = format!("job-{}", state.next_id.fetch_add(1, Ordering::Relaxed));
    let (cancel, _) = watch::channel(false);
    let snapshot = JobSnapshot { id, status: "queued".into(), error: None,
        document: jobs.items.get(label).and_then(|job| job.snapshot.document.clone()),
        output: jobs.items.get(label).and_then(|job| job.snapshot.output.clone()) };
    jobs.queue.retain(|queued| queued != label);
    jobs.queue.push_back(label.to_string());
    jobs.items.insert(label.to_string(), Job { snapshot: snapshot.clone(), config, cancel, started: Instant::now() });
    drop(jobs);
    notify(app, label, &snapshot);
    let app = app.clone();
    let label = label.to_string();
    let id = snapshot.id.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(180)).await;
        let state = app.state::<TranslationJobs>();
        let Ok(mut jobs) = state.jobs.lock() else { return; };
        let Some(job) = jobs.items.get_mut(&label) else { return; };
        if job.snapshot.id != id || !matches!(job.snapshot.status.as_str(), "queued" | "recognizing") { return; }
        job.cancel.send_replace(true);
        job.snapshot.status = "error".into();
        job.snapshot.error = Some("本地识别等待超时，请重试或重启应用。".into());
        job.config.api_key.clear();
        notify(&app, &label, &job.snapshot);
        let _ = app.emit_to("ocr-worker", "ocr-cancel", &id);
        jobs.queue.retain(|queued| queued != &label);
        if jobs.active.as_deref() == Some(label.as_str()) { jobs.active = None; }
    });
    Ok(snapshot)
}

pub fn snapshot(window: &WebviewWindow) -> Result<Option<JobSnapshot>, AppError> {
    let state = window.app_handle().state::<TranslationJobs>();
    let jobs = state.jobs.lock().map_err(|_| lock_error())?;
    Ok(jobs.items.get(window.label()).map(|job| job.snapshot.clone()))
}

pub fn cancel_for_label(app: &AppHandle, label: &str, remove: bool) {
    let state = app.state::<TranslationJobs>();
    let Ok(mut jobs) = state.jobs.lock() else { return; };
    jobs.queue.retain(|queued| queued != label);
    let active = jobs.active.as_deref() == Some(label);
    if active { jobs.active = None; }
    if let Some(job) = jobs.items.get_mut(label) {
        job.cancel.send_replace(true);
        job.config.api_key.clear();
        job.snapshot.status = "cancelled".into();
        job.snapshot.error = None;
        let snapshot = job.snapshot.clone();
        if active { let _ = app.emit_to("ocr-worker", "ocr-cancel", &snapshot.id); }
        if !remove { notify(app, label, &snapshot); }
    }
    if remove { jobs.items.remove(label); }
}

pub fn cancel_pending(app: &AppHandle) {
    let state = app.state::<TranslationJobs>();
    let labels = state.jobs.lock().ok().map(|jobs| jobs.items.iter()
        .filter(|(_, job)| matches!(job.snapshot.status.as_str(), "queued" | "recognizing" | "translating"))
        .map(|(label, _)| label.clone()).collect::<Vec<_>>()).unwrap_or_default();
    for label in labels { cancel_for_label(app, &label, false); }
}

pub fn take_next(window: &WebviewWindow) -> Result<Option<OcrTask>, AppError> {
    if window.label() != "ocr-worker" { return Err(AppError::Validation("OCR 任务仅供内部窗口读取。".into())); }
    let app = window.app_handle();
    let state = app.state::<TranslationJobs>();
    let mut jobs = state.jobs.lock().map_err(|_| lock_error())?;
    if let Some(label) = jobs.active.clone() {
        let timed_out = jobs.items.get(&label).map(|job| job.started.elapsed() > Duration::from_secs(120)).unwrap_or(true);
        if !timed_out { return Ok(None); }
        if let Some(job) = jobs.items.get_mut(&label) {
            job.snapshot.status = "error".into();
            job.snapshot.error = Some("本地 OCR 超时，请缩小截图后重试。".into());
            job.config.api_key.clear();
            notify(app, &label, &job.snapshot);
            let _ = app.emit_to("ocr-worker", "ocr-cancel", &job.snapshot.id);
        }
        jobs.active = None;
    }
    while let Some(label) = jobs.queue.pop_front() {
        let image = match pinned_screenshot::image_for_label(app, &label) {
            Ok(image) => image,
            Err(_) => { jobs.items.remove(&label); continue; }
        };
        let Some(job) = jobs.items.get_mut(&label) else { continue; };
        job.snapshot.status = "recognizing".into();
        job.started = Instant::now();
        let task = OcrTask { id: job.snapshot.id.clone(), image, source_language: job.config.settings.source_language.clone() };
        notify(app, &label, &job.snapshot);
        jobs.active = Some(label);
        return Ok(Some(task));
    }
    Ok(None)
}

pub async fn complete_ocr(window: WebviewWindow, id: String, document: Option<OcrDocument>) -> Result<(), AppError> {
    if window.label() != "ocr-worker" { return Err(AppError::Validation("OCR 结果来源无效。".into())); }
    let app = window.app_handle().clone();
    let state = app.state::<TranslationJobs>();
    let (label, config, cancellation) = {
        let mut jobs = state.jobs.lock().map_err(|_| lock_error())?;
        let Some(label) = jobs.active.clone() else { return Ok(()); };
        let Some(job) = jobs.items.get_mut(&label) else { return Ok(()); };
        if job.snapshot.id != id { return Ok(()); }
        let result = document.as_ref().ok_or_else(|| AppError::Translation("本地识别失败，请检查图片或缩小区域后重试。".into()))
            .and_then(translation::validate_document);
        if let Err(error) = result {
            job.snapshot.status = "error".into(); job.snapshot.error = Some(error.to_string());
            job.config.api_key.clear();
            notify(&app, &label, &job.snapshot);
            jobs.active = None;
            return Ok(());
        }
        job.snapshot.document = document.clone();
        job.snapshot.status = "translating".into();
        notify(&app, &label, &job.snapshot);
        let value = (label, job.config.clone(), job.cancel.subscribe());
        jobs.active = None;
        value
    };
    let document = document.ok_or_else(lock_error)?;
    let slots = state.network_slots.clone();
    // OCR has completed, so the single worker can serve another image while HTTP runs.
    tauri::async_runtime::spawn(async move {
        let mut cancellation = cancellation;
        if *cancellation.borrow() { return; }
        let permit = tokio::select! {
            _ = cancellation.changed() => return,
            permit = slots.acquire_owned() => permit,
        };
        let Ok(_permit) = permit else { return; };
        let result = translation::translate_document(document, config, cancellation).await;
        let state = app.state::<TranslationJobs>();
        let Ok(mut jobs) = state.jobs.lock() else { return; };
        let Some(job) = jobs.items.get_mut(&label) else { return; };
        if job.snapshot.id != id || job.snapshot.status != "translating" { return; }
        job.config.api_key.clear();
        match result {
            Ok(output) => { job.snapshot.output = Some(output); job.snapshot.status = "success".into(); job.snapshot.error = None; }
            Err(error) => { job.snapshot.status = "error".into(); job.snapshot.error = Some(error.to_string()); }
        }
        notify(&app, &label, &job.snapshot);
    });
    Ok(())
}
