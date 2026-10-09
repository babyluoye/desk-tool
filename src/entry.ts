const route = window.location.hash.slice(1);

if (route === "capture") {
  if (navigator.userAgent.includes("Windows")) void import("./capture");
} else {
  void import("./main");
}
