if (window.location.hash === "#floating") {
  void import("./floating");
} else {
  void import("./main");
}
