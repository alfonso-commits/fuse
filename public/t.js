(function () {
  "use strict";

  // Find the script tag to read config
  var scripts = document.getElementsByTagName("script");
  var currentScript = scripts[scripts.length - 1];
  var API =
    (currentScript && currentScript.getAttribute("data-api")) ||
    window.location.origin;
  var ENDPOINT = API + "/api/track";
  var COOKIE_NAME = "_fuse_id";
  var SESSION_KEY = "_fuse_sid";
  var UTM_KEY = "_fuse_utm";
  var UTM_PARAMS = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
  ];

  // Cookie helpers
  function getCookie(name) {
    var match = document.cookie.match(
      new RegExp("(^| )" + name + "=([^;]+)")
    );
    return match ? decodeURIComponent(match[2]) : null;
  }

  function setCookie(name, value, days) {
    var expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie =
      name +
      "=" +
      encodeURIComponent(value) +
      ";expires=" +
      expires +
      ";path=/;SameSite=Lax";
  }

  // Generate a UUID
  function generateId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
      /[xy]/g,
      function (c) {
        var r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      }
    );
  }

  // Get or create anonymous ID (persisted in cookie, 1 year)
  function getAnonId() {
    var id = getCookie(COOKIE_NAME);
    if (!id) {
      id = generateId();
      setCookie(COOKIE_NAME, id, 365);
    }
    return id;
  }

  // Get or create session ID (per tab, via sessionStorage)
  function getSessionId() {
    var sid;
    try {
      sid = sessionStorage.getItem(SESSION_KEY);
    } catch (e) {}
    if (!sid) {
      sid = generateId();
      try {
        sessionStorage.setItem(SESSION_KEY, sid);
      } catch (e) {}
    }
    return sid;
  }

  // Extract UTM params from current URL and persist
  function getUtmParams() {
    var params = new URLSearchParams(window.location.search);
    var utm = {};
    var hasUtm = false;
    UTM_PARAMS.forEach(function (key) {
      var val = params.get(key);
      if (val) {
        // Map utm_source -> utmSource
        var camel = key.replace(/_([a-z])/g, function (_, c) {
          return c.toUpperCase();
        });
        utm[camel] = val;
        hasUtm = true;
      }
    });
    // Persist new UTM to localStorage
    if (hasUtm) {
      try {
        localStorage.setItem(UTM_KEY, JSON.stringify(utm));
      } catch (e) {}
    }
    // Return current or stored UTM
    if (hasUtm) return utm;
    try {
      var stored = localStorage.getItem(UTM_KEY);
      return stored ? JSON.parse(stored) : {};
    } catch (e) {
      return {};
    }
  }

  // Send event via sendBeacon or fetch
  function send(payload) {
    var data = JSON.stringify(payload);
    try {
      if (navigator.sendBeacon) {
        var blob = new Blob([data], { type: "application/json" });
        navigator.sendBeacon(ENDPOINT, blob);
      } else {
        fetch(ENDPOINT, {
          method: "POST",
          body: data,
          headers: { "Content-Type": "application/json" },
          keepalive: true,
        });
      }
    } catch (e) {}
  }

  // Build base payload
  function basePayload() {
    var utm = getUtmParams();
    return Object.assign(
      {
        anonymousId: getAnonId(),
        sessionId: getSessionId(),
        url: window.location.href,
        title: document.title,
        referrer: document.referrer || null,
      },
      utm
    );
  }

  // Track page view
  function trackPageView() {
    send(Object.assign({}, basePayload(), { type: "page_view" }));
  }

  // Track page view on load
  trackPageView();

  // Track clicks on links, buttons, and [data-track] elements
  document.addEventListener(
    "click",
    function (e) {
      var el = e.target;
      // Walk up to find a trackable element
      while (el && el !== document) {
        if (
          el.tagName === "A" ||
          el.tagName === "BUTTON" ||
          el.hasAttribute("data-track")
        ) {
          break;
        }
        el = el.parentElement;
      }
      if (!el || el === document) return;

      send(
        Object.assign({}, basePayload(), {
          type: "click",
          elementId: el.id || null,
          elementText: (el.textContent || "").trim().slice(0, 200) || null,
          elementHref: el.href || null,
        })
      );
    },
    true
  );

  // SPA navigation tracking
  var origPushState = history.pushState;
  history.pushState = function () {
    origPushState.apply(this, arguments);
    setTimeout(trackPageView, 0);
  };
  var origReplaceState = history.replaceState;
  history.replaceState = function () {
    origReplaceState.apply(this, arguments);
    setTimeout(trackPageView, 0);
  };
  window.addEventListener("popstate", function () {
    setTimeout(trackPageView, 0);
  });

  // Expose global identify function
  window.fuse = {
    identify: function (email, props) {
      props = props || {};
      send(
        Object.assign({}, basePayload(), {
          type: "identify",
          email: email,
          name: props.name || null,
          company: props.company || null,
        })
      );
    },
    track: function (eventName, metadata) {
      send(
        Object.assign({}, basePayload(), {
          type: eventName,
          metadata: metadata || null,
        })
      );
    },
  };
})();
