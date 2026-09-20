/**
 * ERVENOW — تدرّج نماذج حجز الخدمات (التالي / السابق + تحقق لكل خطوة)
 */
(function (global) {
  "use strict";

  function qs(root, sel) {
    return root.querySelector(sel);
  }

  function qsa(root, sel) {
    return Array.prototype.slice.call(root.querySelectorAll(sel));
  }

  function ErvenowServiceBookingWizard(options) {
    var opts = options || {};
    this.root = typeof opts.root === "string" ? document.querySelector(opts.root) : opts.root;
    if (!this.root) return;
    this.form = qs(this.root, opts.formSelector || "form");
    this.panels = qsa(this.root, "[data-sb-step]");
    this.stepItems = qsa(this.root, ".erv-sb-steps__item");
    this.btnPrev = qs(this.root, "[data-sb-prev]");
    this.btnNext = qs(this.root, "[data-sb-next]");
    this.btnSubmit = qs(this.root, "[data-sb-submit]");
    this.validateStep = typeof opts.validateStep === "function" ? opts.validateStep : function () {
      return true;
    };
    this.onStepChange = typeof opts.onStepChange === "function" ? opts.onStepChange : null;
    this.total = this.panels.length;
    this.index = 0;
    this._bind();
    this.go(0, true);
  }

  ErvenowServiceBookingWizard.prototype._bind = function () {
    var self = this;
    if (this.btnPrev) {
      this.btnPrev.addEventListener("click", function () {
        self.prev();
      });
    }
    if (this.btnNext) {
      this.btnNext.addEventListener("click", function () {
        self.next();
      });
    }
    this.stepItems.forEach(function (item, i) {
      item.addEventListener("click", function () {
        if (i < self.index) self.go(i);
      });
    });
  };

  ErvenowServiceBookingWizard.prototype.go = function (index, silent) {
    if (!this.total) return;
    var next = Math.max(0, Math.min(this.total - 1, index));
    this.index = next;
    this.panels.forEach(function (panel, i) {
      panel.classList.toggle("is-active", i === next);
      panel.hidden = i !== next;
      panel.setAttribute("aria-hidden", i === next ? "false" : "true");
    });
    this.stepItems.forEach(function (item, i) {
      item.classList.toggle("is-active", i === next);
      item.classList.toggle("is-done", i < next);
      item.setAttribute("aria-current", i === next ? "step" : "false");
    });
    if (this.btnPrev) this.btnPrev.hidden = next === 0;
    if (this.btnNext) this.btnNext.hidden = next === this.total - 1;
    if (this.btnSubmit) this.btnSubmit.hidden = next !== this.total - 1;
    if (!silent && this.onStepChange) this.onStepChange(next, this.total);
    try {
      var active = this.panels[next];
      if (active && active.scrollIntoView) {
        active.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    } catch (e) {}
  };

  ErvenowServiceBookingWizard.prototype.next = function () {
    if (!this.validateStep(this.index + 1, this.index)) return false;
    if (this.index >= this.total - 1) return false;
    this.go(this.index + 1);
    return true;
  };

  ErvenowServiceBookingWizard.prototype.prev = function () {
    if (this.index <= 0) return false;
    this.go(this.index - 1);
    return true;
  };

  ErvenowServiceBookingWizard.prototype.getIndex = function () {
    return this.index;
  };

  global.ErvenowServiceBookingWizard = ErvenowServiceBookingWizard;
})(typeof window !== "undefined" ? window : this);
