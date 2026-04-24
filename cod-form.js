/*!
 * CODI landing-page form — vanilla JS, zero deps.
 * Reads window.COD_CONFIG, injects the form into #cod-form-container,
 * handles bundle selection, submit, upsell tunnel, and success page.
 *
 * Host page must define window.COD_CONFIG before loading this script.
 */
(function () {
  "use strict";

  // ────────────────────────────────────────────────────────────────
  //  Config validation
  // ────────────────────────────────────────────────────────────────
  var CONFIG = window.COD_CONFIG;
  if (!CONFIG || !CONFIG.productId || !CONFIG.codiApiUrl) {
    console.error("[cod-form] window.COD_CONFIG is missing or incomplete.");
    return;
  }
  CONFIG.productName = CONFIG.productName || "Produit";
  CONFIG.devise = CONFIG.devise || "FCFA";
  CONFIG.deviseUSDRate = Number(CONFIG.deviseUSDRate) || 0;
  CONFIG.bundles = Array.isArray(CONFIG.bundles) ? CONFIG.bundles : [];
  CONFIG.upsells = Array.isArray(CONFIG.upsells) ? CONFIG.upsells : [];

  // Remember which productName was set inline on the LP — used so the API
  // response only overrides it when CODI actually has a name on the product.
  var PRODUCT_NAME_FROM_CONFIG = window.COD_CONFIG && window.COD_CONFIG.productName;

  var API = CONFIG.codiApiUrl.replace(/\/$/, "");
  var LS_KEY = "cod_customer";

  // ────────────────────────────────────────────────────────────────
  //  State — bundleIndex is recomputed in init() after the API merge.
  // ────────────────────────────────────────────────────────────────
  var state = {
    bundleIndex: 0,
    orderId: null,
    upsellsAccepted: [],
    detectedCountry: "",
    fbEventId: generateEventId(),
    fbc: "",
    fbp: "",
    submitting: false,
  };

  // ────────────────────────────────────────────────────────────────
  //  Helpers
  // ────────────────────────────────────────────────────────────────
  function fmt(n) {
    return Math.round(Number(n) || 0).toLocaleString("fr-FR") + " " + CONFIG.devise;
  }
  function toUSD(n) {
    return Math.round(Number(n) * CONFIG.deviseUSDRate * 100) / 100;
  }
  function generateEventId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return (
      "ev-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10)
    );
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function esc(s) {
    return escapeHtml(s);
  }
  function $(sel, root) {
    return (root || document).querySelector(sel);
  }
  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function getCookie(name) {
    try {
      var parts = ("; " + document.cookie).split("; " + name + "=");
      if (parts.length === 2) {
        var v = parts.pop();
        if (v) return v.split(";").shift() || "";
      }
    } catch (e) {
      // document.cookie may throw in some sandboxed iframes
    }
    return "";
  }

  function getFbc() {
    // Meta sets _fbc after a successful fbclid visit — prefer it.
    var fromCookie = getCookie("_fbc");
    if (fromCookie) return fromCookie;
    // Otherwise build from ?fbclid=... (Meta format: fb.1.<ts>.<fbclid>)
    try {
      var params = new URLSearchParams(window.location.search);
      var fbclid = params.get("fbclid");
      if (fbclid) return "fb.1." + Date.now() + "." + fbclid;
    } catch (e) {
      // URLSearchParams absent (very old browsers) — silent fail
    }
    return "";
  }

  function getFbp() {
    return getCookie("_fbp");
  }

  function readStorage() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }
  function writeStorage(data) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(data));
    } catch (e) {
      // quota / private mode — silently ignore
    }
  }

  // ────────────────────────────────────────────────────────────────
  //  Styles (scoped with .cod-* prefix to avoid host collisions)
  // ────────────────────────────────────────────────────────────────
  var CSS = [
    "#cod-form-container{font-family:'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a2e;box-sizing:border-box;}",
    "#cod-form-container *,#cod-form-container *::before,#cod-form-container *::after{box-sizing:border-box;}",
    ".cod-wrap{background:#fff;border-radius:12px;border:1px solid rgba(0,150,199,.18);overflow:hidden;max-width:520px;margin:0 auto;}",
    ".cod-body{padding:16px;}",
    ".cod-intro{font-size:20px;font-weight:700;color:#111;margin:16px 0 14px;line-height:1.4;}",
    ".cod-label{font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px;}",
    ".cod-bundles{display:flex;flex-direction:column;gap:8px;margin-bottom:16px;}",
    ".cod-bundle{border:1.5px solid #e5e7eb;border-radius:8px;padding:10px 12px;cursor:pointer;display:flex;align-items:center;gap:10px;background:#fafafa;position:relative;transition:border-color .15s,background .15s;}",
    ".cod-bundle:hover{border-color:#0096c7;}",
    ".cod-bundle.cod-selected{border-color:#0096c7;background:#e0f4fb;}",
    ".cod-radio{width:16px;height:16px;border-radius:50%;border:2px solid #d1d5db;flex-shrink:0;display:flex;align-items:center;justify-content:center;}",
    ".cod-selected .cod-radio{border-color:#0096c7;background:#0096c7;}",
    ".cod-selected .cod-radio::after{content:'';width:6px;height:6px;border-radius:50%;background:#fff;}",
    ".cod-binfo{flex:1;min-width:0;}",
    ".cod-bname{font-size:12px;font-weight:600;color:#1a1a2e;line-height:1.3;}",
    ".cod-bpromo{font-size:10px;font-weight:600;background:rgba(0,150,199,.1);color:#004e6b;padding:1px 7px;border-radius:20px;margin-top:2px;display:inline-block;}",
    ".cod-bprices{text-align:right;flex-shrink:0;}",
    ".cod-bnew{font-size:14px;font-weight:700;color:#004e6b;display:block;}",
    ".cod-bold{font-size:11px;color:#c0392b;text-decoration:line-through;font-weight:600;}",
    ".cod-field{margin-bottom:11px;}",
    ".cod-field label{display:block;font-size:12px;font-weight:600;color:#1a1a2e;margin-bottom:4px;}",
    ".cod-field label .cod-req{color:#0096c7;}",
    ".cod-input{display:flex;align-items:center;border:1.5px solid #e5e7eb;border-radius:8px;overflow:hidden;transition:border-color .15s;background:#fff;}",
    ".cod-input:focus-within{border-color:#0096c7;}",
    ".cod-icon{width:38px;height:42px;background:#0096c7;display:flex;align-items:center;justify-content:center;flex-shrink:0;}",
    ".cod-icon svg{width:16px;height:16px;fill:#fff;}",
    ".cod-input input,.cod-input select{flex:1;min-width:0;border:none;padding:0 10px;height:44px;font-size:16px;background:transparent;color:#1a1a2e;outline:none;font-family:inherit;}",
    "#cod-form-container input,#cod-form-container select{font-size:16px !important;}",
    "@keyframes cod-bounce{0%,100%{transform:scale(1);}30%{transform:scale(1.03);}60%{transform:scale(.98);}}",
    ".cod-submit{width:100%;padding:13px 16px;background:#0096c7;border:none;border-radius:8px;color:#fff;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:space-between;gap:8px;animation:cod-bounce 1.6s ease infinite;transition:background .15s;margin-top:6px;}",
    ".cod-submit:hover{background:#007aad;animation:none;}",
    ".cod-submit:disabled{background:#9ca3af;animation:none;cursor:not-allowed;}",
    ".cod-btn-price{font-size:15px;font-weight:700;background:rgba(255,255,255,.2);padding:3px 10px;border-radius:6px;white-space:nowrap;}",
    ".cod-secure{display:flex;align-items:center;justify-content:center;gap:5px;font-size:11px;color:#6b7280;margin-top:10px;}",
    ".cod-secure svg{width:12px;height:12px;fill:#6b7280;}",
    ".cod-err{background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;font-size:12px;font-weight:500;padding:8px 10px;border-radius:6px;margin-bottom:10px;display:none;}",
    ".cod-sticky{position:fixed;bottom:0;left:0;right:0;background:#fff;border-top:1px solid rgba(0,0,0,.1);padding:10px 16px;z-index:2147483600;transform:translateY(100%);transition:transform .3s ease;display:flex;align-items:center;gap:12px;font-family:'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;}",
    ".cod-sticky.cod-show{transform:translateY(0);}",
    ".cod-sticky-info{flex:1;min-width:0;}",
    ".cod-sticky-name{font-size:14px;font-weight:600;color:#1a1a2e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
    ".cod-sticky-btn{flex-shrink:0;padding:12px 16px;background:#0096c7;border:none;border-radius:8px;color:#fff;font-size:16px;font-weight:700;cursor:pointer;white-space:nowrap;font-family:inherit;display:flex;align-items:center;gap:8px;animation:cod-bounce 1.6s ease infinite;transition:background .15s;}",
    ".cod-sticky-btn:hover{background:#007aad;animation:none;}",
    ".cod-overlay{position:fixed;inset:0;background:#f8f6f2;z-index:2147483647;overflow-y:auto;font-family:'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a2e;}",
    ".cod-overlay .cod-top{background:#0096c7;padding:14px 20px;text-align:center;color:#fff;}",
    ".cod-step-hint{font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:rgba(255,255,255,.8);}",
    ".cod-step-title{font-size:15px;font-weight:600;margin-top:2px;}",
    ".cod-urgency{background:#fffbeb;border-bottom:1px solid #fde68a;padding:8px 20px;font-size:12px;color:#92400e;font-weight:600;text-align:center;}",
    ".cod-overlay-body{max-width:520px;margin:0 auto;padding:20px;}",
    ".cod-progress{display:flex;gap:6px;margin-bottom:18px;align-items:center;}",
    ".cod-pstep{flex:1;height:4px;border-radius:2px;background:#e5e7eb;}",
    ".cod-pstep.cod-done{background:#0096c7;}",
    ".cod-pstep.cod-cur{background:#0096c7;opacity:.45;}",
    ".cod-plabel{font-size:11px;color:#6b7280;white-space:nowrap;}",
    ".cod-recap{background:#fff;border-radius:12px;padding:14px 16px;margin-bottom:18px;border:.5px solid rgba(0,0,0,.07);}",
    ".cod-recap-row{display:flex;align-items:center;justify-content:space-between;font-size:13px;padding:4px 0;gap:8px;}",
    ".cod-recap-row .cod-lbl{color:#6b7280;flex:1;}",
    ".cod-recap-row .cod-old{color:#c0392b;text-decoration:line-through;font-size:12px;font-weight:600;white-space:nowrap;}",
    ".cod-recap-row .cod-nw{color:#1a1a2e;font-weight:600;margin-left:6px;white-space:nowrap;}",
    ".cod-recap-sep{border:none;border-top:.5px solid #f3f4f6;margin:6px 0;}",
    ".cod-recap-row.cod-total .cod-lbl{font-weight:600;color:#1a1a2e;}",
    ".cod-recap-row.cod-total .cod-nw{color:#004e6b;font-size:15px;}",
    ".cod-savings{background:#fef2f2;border-radius:6px;padding:6px 10px;font-size:12px;font-weight:600;color:#c0392b;text-align:center;margin-top:8px;}",
    ".cod-up-card{background:#fff;border-radius:12px;overflow:hidden;margin-bottom:18px;border:.5px solid rgba(0,0,0,.07);}",
    ".cod-up-img{width:100%;height:150px;background:linear-gradient(135deg,#e0f4fb,#b3e5f5);display:flex;align-items:center;justify-content:center;font-size:60px;}",
    ".cod-up-img img{width:100%;height:100%;object-fit:contain;}",
    ".cod-up-info{padding:16px;}",
    ".cod-up-name{font-size:18px;font-weight:700;color:#1a1a2e;margin-bottom:6px;}",
    ".cod-up-desc{font-size:13px;color:#6b7280;line-height:1.6;margin-bottom:12px;}",
    ".cod-up-p{display:flex;align-items:baseline;gap:10px;}",
    ".cod-up-nw{font-size:22px;font-weight:700;color:#004e6b;}",
    ".cod-up-old{font-size:14px;color:#c0392b;text-decoration:line-through;font-weight:600;}",
    ".cod-up-badge{margin-left:auto;background:#e0f4fb;color:#004e6b;font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;}",
    ".cod-btn-yes{width:100%;padding:15px 16px;border:none;border-radius:8px;color:#fff;font-family:inherit;animation:cod-bounce 1.6s ease infinite;display:flex;align-items:center;justify-content:space-between;cursor:pointer;margin-bottom:12px;font-size:15px;font-weight:700;}",
    ".cod-btn-yes:hover{animation:none;filter:brightness(.92);}",
    ".cod-btn-no{width:100%;padding:10px;background:transparent;border:none;color:#6b7280;font-size:13px;cursor:pointer;font-family:inherit;text-align:center;text-decoration:underline;text-underline-offset:3px;}",
    ".cod-ok-ic{width:68px;height:68px;background:#0096c7;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 18px;}",
    ".cod-ok-ic svg{width:34px;height:34px;fill:#fff;}",
    ".cod-ok-t{font-size:26px;font-weight:700;text-align:center;color:#1a1a2e;margin-bottom:10px;}",
    ".cod-ok-s{font-size:14px;color:#6b7280;text-align:center;line-height:1.65;margin-bottom:24px;}",
    ".cod-ok-num{background:#0096c7;border-radius:12px;padding:16px;text-align:center;margin-bottom:18px;color:#fff;}",
    ".cod-ok-num .cod-nl{font-size:11px;color:rgba(255,255,255,.75);text-transform:uppercase;letter-spacing:.06em;}",
    ".cod-ok-num .cod-nv{font-size:22px;font-weight:700;margin-top:4px;}",
    ".cod-wa{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px;display:flex;align-items:flex-start;gap:10px;font-size:13px;color:#065f46;line-height:1.6;margin-top:14px;}",
    ".cod-wa svg{width:20px;height:20px;fill:#059669;flex-shrink:0;margin-top:1px;}",
    ".cod-spinner{display:flex;align-items:center;justify-content:center;min-height:240px;padding:40px 20px;}",
    ".cod-spinner-ring{width:36px;height:36px;border:3px solid rgba(0,150,199,.18);border-top-color:#0096c7;border-radius:50%;animation:cod-spin .8s linear infinite;}",
    "@keyframes cod-spin{to{transform:rotate(360deg);}}",
    ".cod-fatal{padding:24px;text-align:center;font-size:13px;color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;}",
  ].join("\n");

  function injectCSS() {
    if (document.getElementById("cod-form-style")) return;
    var s = document.createElement("style");
    s.id = "cod-form-style";
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // ────────────────────────────────────────────────────────────────
  //  SVG icons
  // ────────────────────────────────────────────────────────────────
  var ICONS = {
    user:
      '<svg viewBox="0 0 24 24"><path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/></svg>',
    phone:
      '<svg viewBox="0 0 24 24"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/></svg>',
    pin:
      '<svg viewBox="0 0 24 24"><path d="M12 2C8.1 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7zm0 9.5c-1.4 0-2.5-1.1-2.5-2.5S10.6 6.5 12 6.5s2.5 1.1 2.5 2.5S13.4 11.5 12 11.5z"/></svg>',
    globe:
      '<svg viewBox="0 0 24 24"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-1 17.9C6.9 19.4 3.5 16.1 3 12H8v1c0 1.1.9 2 2 2h1v4.9zM17.9 17c-.3-.8-1-1.2-1.9-1.2H15v-3c0-.6-.4-1-1-1H9v-2h2c.6 0 1-.4 1-1V6h2c1.1 0 2-.9 2-2v-.4C18.9 5 21 8.3 21 12c0 2-.6 3.8-1.6 5.2z"/></svg>',
    secure:
      '<svg viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.5 3.8 10.7 9 12 5.2-1.3 9-6.5 9-12V5L12 1zm0 10.9h7c-.5 4-3.2 7.6-7 8.9V12H5V6.3l7-3.1v8.7z"/></svg>',
    cart:
      '<svg viewBox="0 0 24 24"><path d="M7 18c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm10 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-9.8-3.2l.3.8H19c.8 0 1.4-.5 1.6-1.2L22 7H6L4.4 3H1v2h2l3.6 8.6z"/></svg>',
    clock:
      '<svg viewBox="0 0 24 24"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm.5 5v5.2l4.3 2.6-.8 1.2-5-3V7h1.5z"/></svg>',
    check:
      '<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>',
    wa:
      '<svg viewBox="0 0 24 24"><path d="M17.5 14.4c-.3-.1-1.7-.8-2-1-.3-.1-.5-.1-.7.1-.2.3-.8 1-.9 1.2-.2.2-.3.2-.6.1-.3-.1-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.6-2.1-.2-.3 0-.5.1-.6l.4-.5c.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5C10 9 9.4 7.6 9.1 7c-.2-.5-.5-.5-.7-.5h-.6C7.6 6.5 7 7.1 7 8.3c0 1.3.9 2.5 1 2.7.1.2 1.8 2.7 4.3 3.8.6.3 1.1.4 1.5.5.6.2 1.2.1 1.6-.1.5-.2 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2-.1-.1-.3-.2-.7-.4zM12.1 21.9C10.4 21.9 8.8 21.4 7.4 20.5l-.3-.2-3.3.9.9-3.2-.2-.3C3.5 16.2 3 14.2 3 12.1 3 7.1 7.1 3 12.1 3s9.1 4.1 9.1 9.1-4.1 9.8-9.1 9.8zm0-18C6.5 3.9 2 8.4 2 12.1c0 2.2.6 4.3 1.8 6.2l-1.2 4.3 4.4-1.1c1.8 1 3.8 1.5 5.9 1.5C18.6 23 23 18.6 23 12.1 23 6.5 18.6 2 12.1 2z"/></svg>',
  };

  // ────────────────────────────────────────────────────────────────
  //  Country options (fallback list — full country names accepted by CODI)
  // ────────────────────────────────────────────────────────────────
  var COUNTRY_OPTIONS = [
    "Côte d'Ivoire",
    "Sénégal",
    "Mali",
    "Guinée",
    "Burkina Faso",
    "Togo",
    "Bénin",
    "Niger",
    "Tchad",
    "Cameroun",
    "Gabon",
    "Congo",
    "RD Congo",
  ];

  // ────────────────────────────────────────────────────────────────
  //  Render — main form
  // ────────────────────────────────────────────────────────────────
  function renderForm() {
    var container = $("#cod-form-container");
    if (!container) {
      console.error("[cod-form] #cod-form-container not found in the DOM.");
      return;
    }

    var b = CONFIG.bundles[state.bundleIndex];
    var bundlesHtml = CONFIG.bundles
      .map(function (bundle, i) {
        var sel = i === state.bundleIndex ? " cod-selected" : "";
        var promoTag = bundle.promo
          ? '<div class="cod-bpromo">' + esc(bundle.promo) + "</div>"
          : "";
        return (
          '<div class="cod-bundle' +
          sel +
          '" data-idx="' +
          i +
          '">' +
          '<div class="cod-radio"></div>' +
          '<div class="cod-binfo"><div class="cod-bname">' +
          esc(bundle.name) +
          "</div>" +
          promoTag +
          "</div>" +
          '<div class="cod-bprices">' +
          '<span class="cod-bnew">' +
          fmt(bundle.price) +
          "</span>" +
          (bundle.oldPrice > bundle.price
            ? '<span class="cod-bold">' + fmt(bundle.oldPrice) + "</span>"
            : "") +
          "</div>" +
          "</div>"
        );
      })
      .join("");

    var countriesHtml = COUNTRY_OPTIONS.map(function (c) {
      return '<option value="' + esc(c) + '">' + esc(c) + "</option>";
    }).join("");

    container.innerHTML =
      '<div class="cod-wrap">' +
      '<div class="cod-body">' +
      '<div class="cod-label">Choisissez votre offre</div>' +
      '<div class="cod-bundles" data-role="bundles">' +
      bundlesHtml +
      "</div>" +
      '<p class="cod-intro">Remplissez le formulaire ci-dessous pour passer votre commande. Paiement à la livraison.</p>' +
      '<div class="cod-err" data-role="err"></div>' +
      '<div class="cod-field">' +
      '<label>Prénom <span class="cod-req">*</span></label>' +
      '<div class="cod-input"><div class="cod-icon">' +
      ICONS.user +
      '</div><input type="text" data-field="prenom" autocomplete="given-name" placeholder="Votre prénom"></div>' +
      "</div>" +
      '<div class="cod-field">' +
      '<label>Numéro WhatsApp <span class="cod-req">*</span></label>' +
      '<div class="cod-input"><div class="cod-icon">' +
      ICONS.phone +
      '</div><input type="tel" data-field="phone" autocomplete="tel" placeholder="Ex: +225 07 00 00 00"></div>' +
      "</div>" +
      '<div class="cod-field">' +
      '<label>Lieu de livraison <span class="cod-req">*</span></label>' +
      '<div class="cod-input"><div class="cod-icon">' +
      ICONS.pin +
      '</div><input type="text" data-field="lieu" autocomplete="street-address" placeholder="Quartier, ville..."></div>' +
      "</div>" +
      '<div class="cod-field">' +
      '<label>Pays <span style="font-weight:400;color:#6b7280">(optionnel)</span></label>' +
      '<div class="cod-input"><div class="cod-icon">' +
      ICONS.globe +
      '</div><select data-field="pays" autocomplete="country-name"><option value="">Sélectionner un pays</option>' +
      countriesHtml +
      "</select></div>" +
      "</div>" +
      '<button type="button" class="cod-submit" data-role="submit">' +
      "<span>Commander maintenant</span>" +
      '<span class="cod-btn-price" data-role="btn-price">' +
      fmt(b.price) +
      "</span>" +
      "</button>" +
      '<div class="cod-secure">' +
      ICONS.secure +
      " Commande 100% sécurisée · Livraison à domicile</div>" +
      "</div></div>";

    // Sticky bar (appended to body, reused across renders)
    if (!$("#cod-sticky-bar")) {
      var sticky = document.createElement("div");
      sticky.id = "cod-sticky-bar";
      sticky.className = "cod-sticky";
      sticky.innerHTML =
        '<div class="cod-sticky-info">' +
        '<div class="cod-sticky-name" data-role="s-name"></div>' +
        "</div>" +
        '<button type="button" class="cod-sticky-btn" data-role="s-btn">' +
        "<span>Commander</span>" +
        '<span class="cod-btn-price" data-role="s-btn-price"></span>' +
        "</button>";
      document.body.appendChild(sticky);
    }
    refreshStickyContent();
    bindFormEvents();
    prefillFromStorage();
  }

  function refreshStickyContent() {
    var b = CONFIG.bundles[state.bundleIndex];
    var name = $('[data-role="s-name"]');
    var btnPrice = $('[data-role="s-btn-price"]');
    if (name) name.textContent = CONFIG.productName + " — " + b.name;
    if (btnPrice) btnPrice.textContent = fmt(b.price);
  }

  function bindFormEvents() {
    // Bundle selection
    $$('[data-role="bundles"] .cod-bundle').forEach(function (el) {
      el.addEventListener("click", function () {
        var idx = Number(el.getAttribute("data-idx"));
        if (idx === state.bundleIndex) return;
        state.bundleIndex = idx;
        $$('[data-role="bundles"] .cod-bundle').forEach(function (c) {
          c.classList.remove("cod-selected");
        });
        el.classList.add("cod-selected");
        var b = CONFIG.bundles[idx];
        var p = $('[data-role="btn-price"]');
        if (p) p.textContent = fmt(b.price);
        refreshStickyContent();
      });
    });

    // Submit
    var btn = $('[data-role="submit"]');
    if (btn) btn.addEventListener("click", submit);

    // Sticky scroll → to form
    var sBtn = $('[data-role="s-btn"]');
    if (sBtn)
      sBtn.addEventListener("click", function () {
        var target = $("#cod-form-container");
        if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
      });

    // Sticky show/hide
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  function onScroll() {
    var btn = $('[data-role="submit"]');
    var sticky = $("#cod-sticky-bar");
    if (!btn || !sticky) return;
    var r = btn.getBoundingClientRect();
    var out = r.bottom < 0 || r.top > window.innerHeight;
    sticky.classList.toggle("cod-show", out);
  }

  function prefillFromStorage() {
    var saved = readStorage();
    if (!saved) return;
    ["prenom", "phone", "lieu", "pays"].forEach(function (k) {
      var input = $('[data-field="' + k + '"]');
      if (input && saved[k]) input.value = saved[k];
    });
  }

  function showError(msg) {
    var el = $('[data-role="err"]');
    if (!el) return;
    el.textContent = msg;
    el.style.display = msg ? "block" : "none";
  }

  // ────────────────────────────────────────────────────────────────
  //  Country detection (IP geo)
  // ────────────────────────────────────────────────────────────────
  function detectCountry() {
    // Try HTTPS providers first; ip-api.com is HTTP and blocked on HTTPS pages.
    return fetch("https://ipapi.co/json/", { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("ipapi.co failed");
        return r.json();
      })
      .then(function (d) {
        state.detectedCountry = d.country_name || d.country || "";
      })
      .catch(function () {
        return fetch("https://ipwho.is/", { cache: "no-store" })
          .then(function (r) {
            return r.ok ? r.json() : null;
          })
          .then(function (d) {
            if (d && d.country) state.detectedCountry = d.country;
          })
          .catch(function () {
            // best-effort; leave empty
          });
      });
  }

  // ────────────────────────────────────────────────────────────────
  //  FB ViewContent (server-side via CODI — fire-and-forget)
  // ────────────────────────────────────────────────────────────────
  function sendViewContent() {
    fetch(API + "/api/fb/viewcontent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productId: CONFIG.productId,
        productName: CONFIG.productName,
        country: state.detectedCountry,
        sourceUrl: location.href,
        eventId: state.fbEventId,
        fbc: state.fbc,
        fbp: state.fbp,
      }),
    }).catch(function () {
      // Endpoint may not exist yet or be offline — LP must never break.
    });
  }

  // ────────────────────────────────────────────────────────────────
  //  Submit
  // ────────────────────────────────────────────────────────────────
  function submit() {
    if (state.submitting) return;
    var prenom = ($('[data-field="prenom"]') || {}).value || "";
    var phone = ($('[data-field="phone"]') || {}).value || "";
    var lieu = ($('[data-field="lieu"]') || {}).value || "";
    var pays = ($('[data-field="pays"]') || {}).value || "";
    prenom = prenom.trim();
    phone = phone.trim();
    lieu = lieu.trim();
    pays = pays.trim();

    if (!prenom || !phone || !lieu) {
      showError("Merci de remplir tous les champs obligatoires.");
      return;
    }
    showError("");

    var btn = $('[data-role="submit"]');
    state.submitting = true;
    if (btn) {
      btn.disabled = true;
      var lbl = btn.querySelector("span");
      if (lbl) lbl.textContent = "Envoi en cours...";
    }

    var bundle = CONFIG.bundles[state.bundleIndex];
    var totalAmount = bundle.price;

    var body = {
      productId: CONFIG.productId,
      prenom: prenom,
      phone: phone,
      lieu: lieu,
      pays: pays,
      ipCountry: state.detectedCountry,
      bundleIndex: state.bundleIndex,
      totalAmount: totalAmount,
      totalAmountUSD: toUSD(totalAmount),
      devise: CONFIG.devise,
      upsells: [],
      sourceUrl: location.href,
      fbEventId: state.fbEventId,
    };

    fetch(API + "/api/orders/landing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, data: d };
        });
      })
      .then(function (res) {
        if (!res.ok) throw new Error((res.data && res.data.error) || "Erreur serveur");
        state.orderId = (res.data && res.data.data && res.data.data.orderId) || null;
        writeStorage({ prenom: prenom, phone: phone, lieu: lieu, pays: pays });
        startUpsellFlow();
      })
      .catch(function (err) {
        state.submitting = false;
        if (btn) {
          btn.disabled = false;
          var lbl = btn.querySelector("span");
          if (lbl) lbl.textContent = "Commander maintenant";
        }
        showError(
          err && err.message
            ? "Erreur : " + err.message
            : "Une erreur est survenue. Merci de réessayer."
        );
      });
  }

  // ────────────────────────────────────────────────────────────────
  //  Upsell tunnel
  // ────────────────────────────────────────────────────────────────
  function activeUpsells() {
    // script receives upsells already active-filtered by the admin snippet,
    // but be defensive in case consumer sent them all.
    return CONFIG.upsells.filter(function (u) {
      return u.active !== false;
    });
  }

  function startUpsellFlow() {
    var ups = activeUpsells();
    if (ups.length === 0) {
      finalizeAndShowSuccess();
      return;
    }
    showUpsell(0);
  }

  function buildRecap(includeUpsells) {
    var b = CONFIG.bundles[state.bundleIndex];
    var totalNew = b.price;
    var totalOld = b.oldPrice > b.price ? b.oldPrice : b.price;
    var rows = [
      '<div class="cod-recap-row"><span class="cod-lbl">' +
        esc(b.name) +
        "</span>" +
        (b.oldPrice > b.price
          ? '<span class="cod-old">' + fmt(b.oldPrice) + "</span>"
          : "") +
        '<span class="cod-nw">' +
        fmt(b.price) +
        "</span></div>",
    ];
    includeUpsells.forEach(function (u) {
      totalNew += u.price;
      totalOld += u.oldPrice > u.price ? u.oldPrice : u.price;
      rows.push(
        '<div class="cod-recap-row"><span class="cod-lbl">+ ' +
          esc(u.name) +
          "</span>" +
          (u.oldPrice > u.price
            ? '<span class="cod-old">' + fmt(u.oldPrice) + "</span>"
            : "") +
          '<span class="cod-nw">' +
          fmt(u.price) +
          "</span></div>"
      );
    });
    var savings = totalOld - totalNew;
    return {
      html:
        rows.join("") +
        '<hr class="cod-recap-sep">' +
        '<div class="cod-recap-row cod-total"><span class="cod-lbl">Total à payer</span>' +
        (savings > 0
          ? '<span class="cod-old">' + fmt(totalOld) + "</span>"
          : "") +
        '<span class="cod-nw">' +
        fmt(totalNew) +
        "</span></div>" +
        (savings > 0
          ? '<div class="cod-savings">🎉 Vous économisez ' +
            fmt(savings) +
            " !</div>"
          : ""),
      total: totalNew,
    };
  }

  function showUpsell(idx) {
    var ups = activeUpsells();
    var u = ups[idx];
    if (!u) {
      finalizeAndShowSuccess();
      return;
    }

    removeOverlay();
    var total = ups.length;
    var progressHtml = "";
    for (var i = 0; i < total; i++) {
      var cls = i < idx ? "cod-done" : i === idx ? "cod-cur" : "";
      progressHtml += '<div class="cod-pstep ' + cls + '"></div>';
    }
    progressHtml +=
      '<span class="cod-plabel">Offre ' + (idx + 1) + "/" + total + "</span>";

    var acceptedSoFar = state.upsellsAccepted.map(function (i) {
      return ups[i];
    });
    var recap = buildRecap(acceptedSoFar);

    var imgHtml = u.image
      ? '<img src="' + esc(u.image) + '" alt="">'
      : "🌿";
    var color = u.btnYesColor || "#0096c7";

    var overlay = document.createElement("div");
    overlay.id = "cod-overlay";
    overlay.className = "cod-overlay";
    overlay.innerHTML =
      '<div class="cod-top">' +
      '<div class="cod-step-hint">Offre spéciale — étape ' +
      (idx + 1) +
      "</div>" +
      '<div class="cod-step-title">' +
      (idx === 0
        ? "Votre commande est confirmée !"
        : "Dernière offre avant la livraison") +
      "</div>" +
      "</div>" +
      '<div class="cod-urgency">⏰ Offre exclusive réservée juste pour vous — expire bientôt</div>' +
      '<div class="cod-overlay-body">' +
      '<div class="cod-progress">' +
      progressHtml +
      "</div>" +
      '<div class="cod-recap">' +
      recap.html +
      "</div>" +
      '<div class="cod-up-card">' +
      '<div class="cod-up-img">' +
      imgHtml +
      "</div>" +
      '<div class="cod-up-info">' +
      '<div class="cod-up-name">' +
      esc(u.name) +
      "</div>" +
      '<div class="cod-up-desc">' +
      esc(u.description || "") +
      "</div>" +
      '<div class="cod-up-p"><span class="cod-up-nw">' +
      fmt(u.price) +
      "</span>" +
      (u.oldPrice > u.price
        ? '<span class="cod-up-old">' + fmt(u.oldPrice) + "</span>"
        : "") +
      (u.oldPrice > u.price
        ? '<span class="cod-up-badge">-' +
          Math.round(((u.oldPrice - u.price) / u.oldPrice) * 100) +
          "%</span>"
        : "") +
      "</div>" +
      "</div>" +
      "</div>" +
      '<button type="button" class="cod-btn-yes" style="background:' +
      esc(color) +
      ';" data-role="up-yes">' +
      "<span>" +
      esc(u.btnYesText || "Oui, j'ajoute !") +
      "</span>" +
      '<span class="cod-btn-price">' +
      fmt(u.price) +
      "</span>" +
      "</button>" +
      '<button type="button" class="cod-btn-no" data-role="up-no">' +
      esc(u.btnNoText || "Non merci, je passe cette offre") +
      "</button>" +
      "</div>";

    document.body.appendChild(overlay);
    window.scrollTo(0, 0);

    overlay.querySelector('[data-role="up-yes"]').addEventListener(
      "click",
      function () {
        state.upsellsAccepted.push(idx);
        patchOrderWithUpsells();
        showUpsell(idx + 1);
      }
    );
    overlay.querySelector('[data-role="up-no"]').addEventListener(
      "click",
      function () {
        showUpsell(idx + 1);
      }
    );
  }

  function currentTotals() {
    var ups = activeUpsells();
    var b = CONFIG.bundles[state.bundleIndex];
    var total = b.price;
    var names = [];
    state.upsellsAccepted.forEach(function (i) {
      total += ups[i].price;
      names.push(ups[i].name);
    });
    return { total: total, names: names };
  }

  function patchOrderWithUpsells() {
    if (!state.orderId) return;
    var t = currentTotals();
    fetch(API + "/api/orders/landing", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId: state.orderId,
        upsells: t.names,
        totalAmount: t.total,
      }),
    }).catch(function () {
      // background — ignore
    });
  }

  function removeOverlay() {
    var el = $("#cod-overlay");
    if (el) el.remove();
  }

  // ────────────────────────────────────────────────────────────────
  //  Success
  // ────────────────────────────────────────────────────────────────
  function finalizeAndShowSuccess() {
    patchOrderWithUpsells(); // final state
    removeOverlay();

    var t = currentTotals();
    var ups = activeUpsells();
    var acceptedSoFar = state.upsellsAccepted.map(function (i) {
      return ups[i];
    });
    var recap = buildRecap(acceptedSoFar);
    var num = state.orderId
      ? "#" + state.orderId.slice(-8).toUpperCase()
      : "#CMD-" + Date.now().toString(36).toUpperCase();

    var overlay = document.createElement("div");
    overlay.id = "cod-overlay";
    overlay.className = "cod-overlay";
    overlay.innerHTML =
      '<div class="cod-overlay-body" style="padding:40px 20px;">' +
      '<div class="cod-ok-ic">' +
      ICONS.check +
      "</div>" +
      '<div class="cod-ok-t">Commande confirmée !</div>' +
      '<p class="cod-ok-s">Notre équipe vous contactera sur WhatsApp dans les prochaines heures pour confirmer votre livraison.</p>' +
      '<div class="cod-ok-num">' +
      '<div class="cod-nl">Numéro de commande</div>' +
      '<div class="cod-nv">' +
      esc(num) +
      "</div>" +
      "</div>" +
      '<div class="cod-recap">' +
      recap.html +
      "</div>" +
      '<div class="cod-wa">' +
      ICONS.wa +
      " Notre équipe vous contactera sur WhatsApp pour confirmer l'adresse et le créneau de livraison." +
      "</div>" +
      "</div>";
    document.body.appendChild(overlay);
    window.scrollTo(0, 0);
    // Use t to avoid unused var warnings in strict bundlers
    void t;
  }

  // ────────────────────────────────────────────────────────────────
  //  Live config fetch
  // ────────────────────────────────────────────────────────────────
  function showSpinner() {
    var c = document.getElementById("cod-form-container");
    if (c) c.innerHTML = '<div class="cod-spinner"><div class="cod-spinner-ring"></div></div>';
  }

  function showFatal(msg) {
    var c = document.getElementById("cod-form-container");
    if (c) c.innerHTML = '<div class="cod-fatal">' + esc(msg) + "</div>";
  }

  function fetchAndMerge() {
    if (!CONFIG.productId) return Promise.resolve();
    return fetch(API + "/api/products/" + encodeURIComponent(CONFIG.productId), {
      cache: "no-store",
    })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (json) {
        var p = json && json.data;
        if (!p) throw new Error("Réponse invalide");
        if (Array.isArray(p.bundles) && p.bundles.length > 0) {
          CONFIG.bundles = p.bundles;
        }
        if (Array.isArray(p.upsells)) {
          CONFIG.upsells = p.upsells.filter(function (u) {
            return u && u.active !== false;
          });
        }
        if (p.devise) CONFIG.devise = p.devise;
        if (typeof p.deviseUSDRate === "number") {
          CONFIG.deviseUSDRate = p.deviseUSDRate;
        }
        // productName: API wins when it has one; otherwise keep what was
        // inlined in window.COD_CONFIG (fallback handles offline preview).
        if (p.name) {
          CONFIG.productName = p.name;
        } else if (PRODUCT_NAME_FROM_CONFIG) {
          CONFIG.productName = PRODUCT_NAME_FROM_CONFIG;
        }
      })
      .catch(function (err) {
        console.warn(
          "[cod-form] Product fetch failed, using embedded fallback config.",
          err && err.message ? err.message : err
        );
      });
  }

  // ────────────────────────────────────────────────────────────────
  //  Init
  // ────────────────────────────────────────────────────────────────
  function init() {
    injectCSS();
    state.fbc = getFbc();
    state.fbp = getFbp();
    showSpinner();

    fetchAndMerge().then(function () {
      if (CONFIG.bundles.length === 0) {
        console.error("[cod-form] At least one bundle is required.");
        showFatal("Configuration produit introuvable.");
        return;
      }
      var defaultIdx = CONFIG.bundles.findIndex(function (b) {
        return b.isDefault;
      });
      state.bundleIndex = defaultIdx >= 0 ? defaultIdx : 0;

      renderForm();
      detectCountry().then(sendViewContent);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
