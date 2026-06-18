/**
 * ERVENOW — هوية العضوية الرسمية (نصوص واجهة فقط)
 */
(function (global) {
  var ID = {
    guest: {
      label: "👋 ضيف ERVENOW",
      short: "ضيف ERVENOW",
      welcomeTitle: "👋 مرحباً بك ضيف ERVENOW",
      browseNote: "أنت تتصفّح كضيف ERVENOW",
    },
    member: {
      label: "⭐ عضو ERVENOW",
      short: "عضو ERVENOW",
      welcomeTitle: "⭐ أهلاً بك عضو ERVENOW",
      profile: "ملف العضوية",
      orders: "طلبات العضو",
      wallet: "محفظة العضو",
      notifications: "إشعارات العضو",
      phone: "جوال العضو",
      confirm: "تأكيد العضو",
    },
    partner: {
      merchant: "🏪 شريك تجاري",
      driver: "🚚 شريك توصيل",
      service: "🔧 شريك خدمات",
      transport: "🚛 شريك نقل",
      admin: "🛡️ الإدارة",
    },
    auth: {
      loginTab: "دخول الأعضاء",
      loginCta: "دخول الأعضاء",
      registerTab: "⭐ إنشاء عضوية جديدة",
      registerCta: "⭐ إنشاء عضوية جديدة",
      registerIntro: "أنشئ عضويتك للاستفادة من جميع الخدمات.",
      registerSubmit: "إنشاء عضوية",
      logout: "تسجيل الخروج",
    },
    platform: {
      home: "منصة ERVENOW",
      homeNav: "منصة ERVENOW",
    },
  };

  function roleLabel(role, serviceType) {
    var r = String(role || "customer").toLowerCase();
    if (r === "customer" || r === "user") return ID.member.short;
    if (r === "driver") return ID.partner.driver;
    if (r === "store" || r === "merchant" || r === "restaurant") return ID.partner.merchant;
    if (r === "admin") return ID.partner.admin;
    if (r === "service" || r === "provider") {
      var st = String(serviceType || "").toLowerCase();
      if (
        st === "pickup_truck" ||
        st === "car_transport" ||
        st === "vehicle_transfer" ||
        st === "internal_delivery"
      ) {
        return ID.partner.transport;
      }
      return ID.partner.service;
    }
    return ID.member.short;
  }

  global.ErvenowMembershipIdentity = {
    ID: ID,
    roleLabel: roleLabel,
  };
})(typeof window !== "undefined" ? window : global);
