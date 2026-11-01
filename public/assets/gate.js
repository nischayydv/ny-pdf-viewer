(function () {
  "use strict";
  // show / hide password
  document.querySelectorAll("[data-toggle-pw]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var input = btn.parentElement.querySelector("input");
      input.type = input.type === "password" ? "text" : "password";
    });
  });
  // prevent double submit
  var form = document.querySelector("form.gate-card");
  if (form) form.addEventListener("submit", function () {
    var b = form.querySelector("button[type=submit]");
    if (b) setTimeout(function () { b.disabled = true; b.textContent = "Checking…"; }, 0);
  });
})();
