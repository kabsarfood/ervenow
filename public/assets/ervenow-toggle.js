/**
 * ERVENOW — أزرار ثنائية: ضغطة تفتح، ضغطة ثانية تغلق
 * يُحمَّل مع guest-shell أو يدوياً ثم ErvenowToggle.boot()
 */
(function (global) {
  "use strict";

  function setExpanded(trigger, open) {
    if (!trigger) return;
    trigger.setAttribute("aria-expanded", open ? "true" : "false");
    trigger.classList.toggle("is-active", open);
  }

  function resolveTargets(trigger) {
    var sel = trigger.getAttribute("data-erv-toggle");
    if (!sel) return [];
    try {
      return Array.prototype.slice.call(document.querySelectorAll(sel));
    } catch (e) {
      return [];
    }
  }

  function setTargetsOpen(targets, open) {
    targets.forEach(function (el) {
      if (el.tagName === "DETAILS") {
        if (open) el.setAttribute("open", "");
        else el.removeAttribute("open");
        return;
      }
      if (el.hasAttribute("hidden")) el.hidden = !open;
      el.classList.toggle("is-open", open);
      el.setAttribute("aria-hidden", open ? "false" : "true");
    });
  }

  function isOpen(trigger, targets) {
    if (trigger && trigger.getAttribute("aria-expanded") === "true") return true;
    if (!targets.length) return false;
    return targets.some(function (t) {
      if (t.tagName === "DETAILS") return t.open;
      if (t.hasAttribute("hidden")) return !t.hidden;
      return t.classList.contains("is-open");
    });
  }

  function bindToggleTrigger(trigger) {
    if (trigger.__ervToggleBound) return;
    trigger.__ervToggleBound = true;
    trigger.addEventListener("click", function (e) {
      var targets = resolveTargets(trigger);
      var next = !isOpen(trigger, targets);
      if (trigger.getAttribute("data-erv-toggle-navigate") !== "true") {
        e.preventDefault();
      }
      setExpanded(trigger, next);
      setTargetsOpen(targets, next);
    });
  }

  /**
   * تبويبات: data-tab على الأزرار، panel-{key} أو [role=tabpanel]
   * @returns {function(string): void} activate
   */
  function bindTabGroup(root, opts) {
    opts = opts || {};
    if (root.__ervTabBound) return root.__ervActivateTab;
    root.__ervTabBound = true;

    var nav =
      root.querySelector(".dash-tabs__nav") ||
      root.querySelector('[role="tablist"]') ||
      root;

    function activate(key) {
      key = key != null ? String(key).trim() : "";
      var tabs = nav.querySelectorAll("[data-tab]");
      var panels = root.querySelectorAll(".dash-tabs__panel, [role='tabpanel']");
      var emptyId = root.getAttribute("data-erv-tabs-empty");
      var empty = emptyId ? document.getElementById(emptyId) : root.querySelector(".dash-tabs__empty");

      tabs.forEach(function (t) {
        var on = !!key && t.getAttribute("data-tab") === key;
        t.setAttribute("aria-selected", on ? "true" : "false");
        t.classList.toggle("is-active", on);
        setExpanded(t, on);
      });

      panels.forEach(function (p) {
        var panelKey = p.getAttribute("data-tab-panel");
        var show = !!key && (p.id === "panel-" + key || panelKey === key);
        p.hidden = !show;
        p.classList.toggle("is-open", show);
      });

      if (empty) empty.hidden = !!key;

      if (opts.onChange) opts.onChange(key);
      return key;
    }

    root.__ervActivateTab = activate;

    function onTabClick(e) {
      var tab = e.target.closest("[data-tab]");
      if (!tab || !root.contains(tab)) return;
      e.preventDefault();
      var key = tab.getAttribute("data-tab");
      if (!key) return;
      var wasOpen = tab.getAttribute("aria-selected") === "true";
      activate(wasOpen ? "" : key);
    }

    nav.addEventListener("click", onTabClick);
    nav.addEventListener("keydown", function (e) {
      var tab = e.target.closest("[data-tab]");
      if (!tab || (e.key !== "Enter" && e.key !== " ")) return;
      e.preventDefault();
      var key = tab.getAttribute("data-tab");
      var wasOpen = tab.getAttribute("aria-selected") === "true";
      activate(wasOpen ? "" : key);
    });

    return activate;
  }

  /** شريط تصنيفات: الضغط على المفعّل يُلغي الاختيار */
  function bindChipBar(bar, handlers) {
    if (!bar || bar.__ervChipBound) return;
    bar.__ervChipBound = true;
    handlers = handlers || {};

    bar.addEventListener(
      "click",
      function (e) {
        var chip = e.target.closest(".stores-cuisine-chip, .ds-svc");
        if (!chip || !bar.contains(chip)) return;

        if (handlers.isActive && handlers.isActive(chip)) {
          e.preventDefault();
          e.stopPropagation();
          if (handlers.onDeactivate) handlers.onDeactivate(chip);
          return;
        }

        if (handlers.onActivate) handlers.onActivate(chip, e);
      },
      true
    );
  }

  function boot() {
    document.querySelectorAll("[data-erv-toggle]").forEach(function (el) {
      if (el.closest("[data-erv-toggle-tabs]")) return;
      bindToggleTrigger(el);
    });

    document.querySelectorAll("[data-erv-toggle-tabs]").forEach(function (root) {
      bindTabGroup(root);
    });
  }

  global.ErvenowToggle = {
    boot: boot,
    bindTabGroup: bindTabGroup,
    bindToggleTrigger: bindToggleTrigger,
    bindChipBar: bindChipBar,
    setExpanded: setExpanded,
    setTargetsOpen: setTargetsOpen,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(window);
