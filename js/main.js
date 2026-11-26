"use strict";

ensureOthersCategory();

attachDatalist("transactionDescription", "transactionDescriptionList");
attachDatalist("recurringDescription", "recurringDescriptionList");
attachDatalist("recurringEditDescription", "recurringEditDescriptionList");
attachDatalist("standaloneDescription", "standaloneDescriptionList");

loadData();

populateDescriptionOptions("transactionDescription", "transactionDescriptionList");
populateDescriptionOptions("recurringDescription", "recurringDescriptionList");
populateDescriptionOptions("standaloneDescription", "standaloneDescriptionList");

bindDashShortcuts();
renderFiltersDropdown();
updateFilterBadge();

updatePainel();
renderDashboard();
updateCloudButtons();
setCalendarSectionOpen(false);
setBackupSectionOpen(false);
setActiveTab("painel");
initGoogleAuth();