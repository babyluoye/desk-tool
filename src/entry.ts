const entry = window.location.hash === "#floating" ? "./floating" : "./main";

void import(entry);
