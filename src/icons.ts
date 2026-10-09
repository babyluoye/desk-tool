interface LucideApi { createIcons(options?: { nameAttr?: string; attrs?: Record<string, string | number> }): void }
let loading: Promise<LucideApi> | null = null;

export function renderIcons(): void {
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = new URL("./icons/lucide.js", window.location.href).toString();
      script.onload = () => {
        const lucide = (window as unknown as { lucide?: LucideApi }).lucide;
        if (lucide) resolve(lucide); else reject(new Error("Icon library unavailable"));
      };
      script.onerror = () => reject(new Error("Icon library unavailable"));
      document.head.append(script);
    });
  }
  void loading.then((lucide) => lucide.createIcons({ attrs: { width: 16, height: 16, "stroke-width": 1.8 } })).catch(() => {});
}

export function icon(name: string): string {
  return `<i data-lucide="${name}" aria-hidden="true"></i>`;
}
