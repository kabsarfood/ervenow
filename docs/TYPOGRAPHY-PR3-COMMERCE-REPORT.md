# ERVENOW Typography PR3 — Commerce Report

**Date:** 2026-06-12
**Scope:** Cart · Checkout · Wallet · My Orders
**Font:** Cairo (unchanged)

## Summary

Typography PR3 applies the PR1 token system to all commerce pages via a scoped apply layer (`body.erv-typography-pr3-commerce`). Commerce-specific tokens extend PR1 for **Price** (18/20/20px · 700) and **Financial Totals** (20/24/24px · 700–800).

### Key fixes

| Area | Before (issue) | After (target) |
|------|----------------|----------------|
| **Wallet — balance** | 32px mobile · 42.4px tablet/desktop (inflated) | 20px mobile · 24px tablet/desktop |
| **Wallet — title** | 16.8px | H1: 24 / 28 / 32px |
| **Checkout — page title** | 21.6px mobile | H1: 24 / 28 / 32px |
| **Checkout — grand total** | 16.8–19.2px | Financial: 20 / 24 / 24px |
| **Orders — hero** | 19.2px mobile (clamp) | H1: 24 / 28 / 32px |
| **Cart — section titles** | 15px | H2/H3 per breakpoint |

### Verification

- **Layout:** `mainW` unchanged across all 12 viewports (390 · 768 · 1280 × 4 pages)
- **Colors / fields / payment logic:** no changes
- **Cairo:** preserved
- **Cart capture:** uses `/cart.html` (route `/cart` redirects to checkout)

## Tokens Applied

| Role | Mobile | Tablet | Desktop | Weight |
|------|--------|--------|---------|--------|
| H1 | 24px | 28px | 32px | 700 |
| H2 | 18px | 20px | 22px | 700 |
| H3 | 16px | 18px | 18px | 600 |
| Body | 16px | 16px | 16px | 400–500 |
| Secondary | 14px | 14px | 14px | 400–500 |
| Caption | 12px | 12px | 12px | 400 |
| Price | 18px | 20px | 20px | 700 |
| Financial Total | 20px | 24px | 24px | 700–800 |

## Screenshots — After

| Page | Mobile 390 | Tablet 768 | Desktop 1280 |
|------|------------|------------|--------------|
| Cart | ![m](screenshots/typography-pr3-commerce/after/cart-390.png) | ![t](screenshots/typography-pr3-commerce/after/cart-768.png) | ![d](screenshots/typography-pr3-commerce/after/cart-1280.png) |
| Checkout | ![m](screenshots/typography-pr3-commerce/after/checkout-390.png) | ![t](screenshots/typography-pr3-commerce/after/checkout-768.png) | ![d](screenshots/typography-pr3-commerce/after/checkout-1280.png) |
| Wallet | ![m](screenshots/typography-pr3-commerce/after/wallet-390.png) | ![t](screenshots/typography-pr3-commerce/after/wallet-768.png) | ![d](screenshots/typography-pr3-commerce/after/wallet-1280.png) |
| Orders | ![m](screenshots/typography-pr3-commerce/after/orders-390.png) | ![t](screenshots/typography-pr3-commerce/after/orders-768.png) | ![d](screenshots/typography-pr3-commerce/after/orders-1280.png) |

## Screenshots — Before

| Page | Mobile 390 | Tablet 768 | Desktop 1280 |
|------|------------|------------|--------------|
| Cart | ![m](screenshots/typography-pr3-commerce/before/cart-390.png) | ![t](screenshots/typography-pr3-commerce/before/cart-768.png) | ![d](screenshots/typography-pr3-commerce/before/cart-1280.png) |
| Checkout | ![m](screenshots/typography-pr3-commerce/before/checkout-390.png) | ![t](screenshots/typography-pr3-commerce/before/checkout-768.png) | ![d](screenshots/typography-pr3-commerce/before/checkout-1280.png) |
| Wallet | ![m](screenshots/typography-pr3-commerce/before/wallet-390.png) | ![t](screenshots/typography-pr3-commerce/before/wallet-768.png) | ![d](screenshots/typography-pr3-commerce/before/wallet-1280.png) |
| Orders | ![m](screenshots/typography-pr3-commerce/before/orders-390.png) | ![t](screenshots/typography-pr3-commerce/before/orders-768.png) | ![d](screenshots/typography-pr3-commerce/before/orders-1280.png) |

## Computed Typography (After)

### cart@390

```json
{
  "pageTitle": {
    "fontSize": "18px",
    "fontWeight": "700",
    "lineHeight": "24.3px"
  },
  "sectionH2": {
    "fontSize": "16px",
    "fontWeight": "600",
    "lineHeight": "21.6px"
  },
  "price": null,
  "financialTotal": {
    "fontSize": "20px",
    "fontWeight": "700",
    "lineHeight": "27px"
  },
  "secondary": {
    "fontSize": "14px",
    "fontWeight": "500",
    "lineHeight": "20.3px"
  },
  "caption": {
    "fontSize": "12px",
    "fontWeight": "400",
    "lineHeight": "17.4px"
  },
  "trustOrNote": {
    "fontSize": "12px",
    "fontWeight": "400",
    "lineHeight": "17.4px"
  },
  "_fontSizeHistogram": [
    {
      "size": "10.5px",
      "count": 3
    },
    {
      "size": "10.88px",
      "count": 2
    },
    {
      "size": "11.2px",
      "count": 1
    },
    {
      "size": "11.52px",
      "count": 2
    },
    {
      "size": "12px",
      "count": 13
    },
    {
      "size": "12.48px",
      "count": 2
    },
    {
      "size": "12.8px",
      "count": 12
    },
    {
      "size": "13.12px",
      "count": 4
    },
    {
      "size": "13.8px",
      "count": 1
    },
    {
      "size": "14px",
      "count": 29
    },
    {
      "size": "14.08px",
      "count": 10
    },
    {
      "size": "14.72px",
      "count": 2
    },
    {
      "size": "15px",
      "count": 1
    },
    {
      "size": "15.2px",
      "count": 1
    },
    {
      "size": "16px",
      "count": 40
    },
    {
      "size": "17.6px",
      "count": 1
    },
    {
      "size": "18px",
      "count": 1
    },
    {
      "size": "18.4px",
      "count": 1
    },
    {
      "size": "19.2px",
      "count": 5
    },
    {
      "size": "20px",
      "count": 3
    },
    {
      "size": "21.6px",
      "count": 1
    }
  ],
  "_layout": {
    "mainW": 390,
    "viewport": 390
  }
}
```

### checkout@390

```json
{
  "pageTitle": {
    "fontSize": "24px",
    "fontWeight": "700",
    "lineHeight": "32.4px"
  },
  "sectionH2": {
    "fontSize": "18px",
    "fontWeight": "700",
    "lineHeight": "24.3px"
  },
  "price": null,
  "financialTotal": {
    "fontSize": "20px",
    "fontWeight": "700",
    "lineHeight": "27px"
  },
  "secondary": {
    "fontSize": "14px",
    "fontWeight": "500",
    "lineHeight": "20.3px"
  },
  "caption": null,
  "trustOrNote": {
    "fontSize": "14px",
    "fontWeight": "500",
    "lineHeight": "20.3px"
  },
  "_fontSizeHistogram": [
    {
      "size": "10.88px",
      "count": 2
    },
    {
      "size": "11.52px",
      "count": 1
    },
    {
      "size": "12.48px",
      "count": 1
    },
    {
      "size": "12.8px",
      "count": 9
    },
    {
      "size": "13.6px",
      "count": 3
    },
    {
      "size": "14px",
      "count": 12
    },
    {
      "size": "14.08px",
      "count": 4
    },
    {
      "size": "14.4px",
      "count": 5
    },
    {
      "size": "14.72px",
      "count": 1
    },
    {
      "size": "15.2px",
      "count": 9
    },
    {
      "size": "16px",
      "count": 36
    },
    {
      "size": "17.6px",
      "count": 1
    },
    {
      "size": "18px",
      "count": 6
    },
    {
      "size": "20px",
      "count": 3
    },
    {
      "size": "21.6px",
      "count": 1
    },
    {
      "size": "24px",
      "count": 1
    }
  ],
  "_layout": {
    "mainW": 390,
    "viewport": 390
  }
}
```

### wallet@390

```json
{
  "pageTitle": {
    "fontSize": "24px",
    "fontWeight": "700",
    "lineHeight": "32.4px"
  },
  "sectionH2": {
    "fontSize": "18px",
    "fontWeight": "700",
    "lineHeight": "24.3px"
  },
  "price": null,
  "financialTotal": {
    "fontSize": "20px",
    "fontWeight": "800",
    "lineHeight": "25px"
  },
  "secondary": {
    "fontSize": "14px",
    "fontWeight": "500",
    "lineHeight": "20.3px"
  },
  "caption": null,
  "trustOrNote": null,
  "_fontSizeHistogram": [
    {
      "size": "11.52px",
      "count": 8
    },
    {
      "size": "12px",
      "count": 11
    },
    {
      "size": "12.48px",
      "count": 4
    },
    {
      "size": "13.12px",
      "count": 6
    },
    {
      "size": "13.3333px",
      "count": 6
    },
    {
      "size": "13.6px",
      "count": 5
    },
    {
      "size": "13.76px",
      "count": 5
    },
    {
      "size": "14px",
      "count": 10
    },
    {
      "size": "14.08px",
      "count": 8
    },
    {
      "size": "14.72px",
      "count": 1
    },
    {
      "size": "16px",
      "count": 62
    },
    {
      "size": "16.8px",
      "count": 1
    },
    {
      "size": "18px",
      "count": 4
    },
    {
      "size": "19.2px",
      "count": 5
    },
    {
      "size": "20px",
      "count": 2
    },
    {
      "size": "21.6px",
      "count": 1
    },
    {
      "size": "24px",
      "count": 1
    }
  ],
  "_layout": {
    "mainW": 390,
    "viewport": 390
  }
}
```

### orders@390

```json
{
  "pageTitle": {
    "fontSize": "24px",
    "fontWeight": "700",
    "lineHeight": "32.4px"
  },
  "sectionH2": null,
  "price": null,
  "financialTotal": null,
  "secondary": null,
  "caption": null,
  "trustOrNote": null,
  "_fontSizeHistogram": [
    {
      "size": "10.88px",
      "count": 1
    },
    {
      "size": "11.52px",
      "count": 1
    },
    {
      "size": "12px",
      "count": 12
    },
    {
      "size": "12.48px",
      "count": 4
    },
    {
      "size": "12.8px",
      "count": 7
    },
    {
      "size": "14px",
      "count": 2
    },
    {
      "size": "14.08px",
      "count": 4
    },
    {
      "size": "14.72px",
      "count": 1
    },
    {
      "size": "15.2px",
      "count": 3
    },
    {
      "size": "16px",
      "count": 26
    },
    {
      "size": "17.6px",
      "count": 1
    },
    {
      "size": "19.2px",
      "count": 5
    },
    {
      "size": "21.6px",
      "count": 1
    },
    {
      "size": "24px",
      "count": 1
    }
  ],
  "_layout": {
    "mainW": 390,
    "viewport": 390
  }
}
```

### cart@768

```json
{
  "pageTitle": {
    "fontSize": "20px",
    "fontWeight": "700",
    "lineHeight": "27px"
  },
  "sectionH2": {
    "fontSize": "18px",
    "fontWeight": "600",
    "lineHeight": "24.3px"
  },
  "price": null,
  "financialTotal": {
    "fontSize": "24px",
    "fontWeight": "700",
    "lineHeight": "32.4px"
  },
  "secondary": {
    "fontSize": "14px",
    "fontWeight": "500",
    "lineHeight": "20.3px"
  },
  "caption": {
    "fontSize": "12px",
    "fontWeight": "400",
    "lineHeight": "17.4px"
  },
  "trustOrNote": {
    "fontSize": "12px",
    "fontWeight": "400",
    "lineHeight": "17.4px"
  },
  "_fontSizeHistogram": [
    {
      "size": "10.5px",
      "count": 3
    },
    {
      "size": "10.88px",
      "count": 1
    },
    {
      "size": "11.2px",
      "count": 1
    },
    {
      "size": "11.52px",
      "count": 3
    },
    {
      "size": "12px",
      "count": 3
    },
    {
      "size": "12.48px",
      "count": 5
    },
    {
      "size": "12.8px",
      "count": 2
    },
    {
      "size": "13.12px",
      "count": 7
    },
    {
      "size": "13.6px",
      "count": 7
    },
    {
      "size": "13.8px",
      "count": 1
    },
    {
      "size": "14px",
      "count": 29
    },
    {
      "size": "14.08px",
      "count": 6
    },
    {
      "size": "14.72px",
      "count": 1
    },
    {
      "size": "15.2px",
      "count": 1
    },
    {
      "size": "16px",
      "count": 32
    },
    {
      "size": "18px",
      "count": 7
    },
    {
      "size": "18.4px",
      "count": 1
    },
    {
      "size": "20px",
      "count": 2
    },
    {
      "size": "20.48px",
      "count": 2
    },
    {
      "size": "24px",
      "count": 3
    }
  ],
  "_layout": {
    "mainW": 768,
    "viewport": 768
  }
}
```

### checkout@768

```json
{
  "pageTitle": {
    "fontSize": "28px",
    "fontWeight": "700",
    "lineHeight": "37.8px"
  },
  "sectionH2": {
    "fontSize": "20px",
    "fontWeight": "700",
    "lineHeight": "27px"
  },
  "price": null,
  "financialTotal": {
    "fontSize": "24px",
    "fontWeight": "700",
    "lineHeight": "32.4px"
  },
  "secondary": {
    "fontSize": "14px",
    "fontWeight": "500",
    "lineHeight": "20.3px"
  },
  "caption": null,
  "trustOrNote": {
    "fontSize": "14px",
    "fontWeight": "500",
    "lineHeight": "20.3px"
  },
  "_fontSizeHistogram": [
    {
      "size": "10.88px",
      "count": 1
    },
    {
      "size": "11.52px",
      "count": 2
    },
    {
      "size": "12.48px",
      "count": 2
    },
    {
      "size": "12.8px",
      "count": 2
    },
    {
      "size": "13.12px",
      "count": 3
    },
    {
      "size": "13.6px",
      "count": 7
    },
    {
      "size": "14px",
      "count": 12
    },
    {
      "size": "14.4px",
      "count": 5
    },
    {
      "size": "15.2px",
      "count": 9
    },
    {
      "size": "16px",
      "count": 34
    },
    {
      "size": "20px",
      "count": 7
    },
    {
      "size": "20.48px",
      "count": 2
    },
    {
      "size": "24px",
      "count": 3
    },
    {
      "size": "28px",
      "count": 1
    }
  ],
  "_layout": {
    "mainW": 768,
    "viewport": 768
  }
}
```

### wallet@768

```json
{
  "pageTitle": {
    "fontSize": "28px",
    "fontWeight": "700",
    "lineHeight": "37.8px"
  },
  "sectionH2": {
    "fontSize": "20px",
    "fontWeight": "700",
    "lineHeight": "27px"
  },
  "price": null,
  "financialTotal": {
    "fontSize": "24px",
    "fontWeight": "800",
    "lineHeight": "30px"
  },
  "secondary": {
    "fontSize": "14px",
    "fontWeight": "500",
    "lineHeight": "20.3px"
  },
  "caption": null,
  "trustOrNote": null,
  "_fontSizeHistogram": [
    {
      "size": "11.52px",
      "count": 8
    },
    {
      "size": "12px",
      "count": 1
    },
    {
      "size": "12.48px",
      "count": 4
    },
    {
      "size": "13.12px",
      "count": 6
    },
    {
      "size": "13.3333px",
      "count": 6
    },
    {
      "size": "13.6px",
      "count": 5
    },
    {
      "size": "13.76px",
      "count": 5
    },
    {
      "size": "14px",
      "count": 10
    },
    {
      "size": "14.08px",
      "count": 8
    },
    {
      "size": "14.72px",
      "count": 1
    },
    {
      "size": "16px",
      "count": 61
    },
    {
      "size": "16.8px",
      "count": 1
    },
    {
      "size": "20px",
      "count": 5
    },
    {
      "size": "21.6px",
      "count": 1
    },
    {
      "size": "24px",
      "count": 1
    },
    {
      "size": "28px",
      "count": 1
    }
  ],
  "_layout": {
    "mainW": 768,
    "viewport": 768
  }
}
```

### orders@768

```json
{
  "pageTitle": {
    "fontSize": "28px",
    "fontWeight": "700",
    "lineHeight": "37.8px"
  },
  "sectionH2": null,
  "price": null,
  "financialTotal": null,
  "secondary": null,
  "caption": null,
  "trustOrNote": null,
  "_fontSizeHistogram": [
    {
      "size": "11.52px",
      "count": 2
    },
    {
      "size": "12px",
      "count": 2
    },
    {
      "size": "12.48px",
      "count": 6
    },
    {
      "size": "12.8px",
      "count": 1
    },
    {
      "size": "13.12px",
      "count": 3
    },
    {
      "size": "13.6px",
      "count": 3
    },
    {
      "size": "14px",
      "count": 2
    },
    {
      "size": "15.2px",
      "count": 3
    },
    {
      "size": "16px",
      "count": 24
    },
    {
      "size": "20px",
      "count": 1
    },
    {
      "size": "20.48px",
      "count": 2
    },
    {
      "size": "28px",
      "count": 1
    }
  ],
  "_layout": {
    "mainW": 768,
    "viewport": 768
  }
}
```

### cart@1280

```json
{
  "pageTitle": {
    "fontSize": "22px",
    "fontWeight": "700",
    "lineHeight": "29.7px"
  },
  "sectionH2": {
    "fontSize": "18px",
    "fontWeight": "600",
    "lineHeight": "24.3px"
  },
  "price": null,
  "financialTotal": {
    "fontSize": "24px",
    "fontWeight": "700",
    "lineHeight": "32.4px"
  },
  "secondary": {
    "fontSize": "14px",
    "fontWeight": "500",
    "lineHeight": "20.3px"
  },
  "caption": {
    "fontSize": "12px",
    "fontWeight": "400",
    "lineHeight": "17.4px"
  },
  "trustOrNote": {
    "fontSize": "12px",
    "fontWeight": "400",
    "lineHeight": "17.4px"
  },
  "_fontSizeHistogram": [
    {
      "size": "10.5px",
      "count": 3
    },
    {
      "size": "10.88px",
      "count": 1
    },
    {
      "size": "11.2px",
      "count": 1
    },
    {
      "size": "11.52px",
      "count": 3
    },
    {
      "size": "12px",
      "count": 3
    },
    {
      "size": "12.48px",
      "count": 5
    },
    {
      "size": "12.8px",
      "count": 1
    },
    {
      "size": "13.12px",
      "count": 4
    },
    {
      "size": "13.44px",
      "count": 4
    },
    {
      "size": "13.6px",
      "count": 7
    },
    {
      "size": "13.8px",
      "count": 1
    },
    {
      "size": "14px",
      "count": 29
    },
    {
      "size": "14.08px",
      "count": 6
    },
    {
      "size": "14.72px",
      "count": 1
    },
    {
      "size": "15.2px",
      "count": 1
    },
    {
      "size": "16px",
      "count": 32
    },
    {
      "size": "18px",
      "count": 7
    },
    {
      "size": "18.4px",
      "count": 1
    },
    {
      "size": "20px",
      "count": 1
    },
    {
      "size": "20.48px",
      "count": 2
    },
    {
      "size": "22px",
      "count": 1
    },
    {
      "size": "24px",
      "count": 3
    }
  ],
  "_layout": {
    "mainW": 1280,
    "viewport": 1280
  }
}
```

### checkout@1280

```json
{
  "pageTitle": {
    "fontSize": "32px",
    "fontWeight": "700",
    "lineHeight": "43.2px"
  },
  "sectionH2": {
    "fontSize": "22px",
    "fontWeight": "700",
    "lineHeight": "29.7px"
  },
  "price": null,
  "financialTotal": {
    "fontSize": "24px",
    "fontWeight": "700",
    "lineHeight": "32.4px"
  },
  "secondary": {
    "fontSize": "14px",
    "fontWeight": "500",
    "lineHeight": "20.3px"
  },
  "caption": null,
  "trustOrNote": {
    "fontSize": "14px",
    "fontWeight": "500",
    "lineHeight": "20.3px"
  },
  "_fontSizeHistogram": [
    {
      "size": "10.88px",
      "count": 1
    },
    {
      "size": "11.52px",
      "count": 2
    },
    {
      "size": "12.48px",
      "count": 2
    },
    {
      "size": "12.8px",
      "count": 1
    },
    {
      "size": "13.44px",
      "count": 4
    },
    {
      "size": "13.6px",
      "count": 7
    },
    {
      "size": "14px",
      "count": 12
    },
    {
      "size": "14.4px",
      "count": 5
    },
    {
      "size": "15.2px",
      "count": 9
    },
    {
      "size": "16px",
      "count": 34
    },
    {
      "size": "20px",
      "count": 1
    },
    {
      "size": "20.48px",
      "count": 2
    },
    {
      "size": "22px",
      "count": 6
    },
    {
      "size": "24px",
      "count": 3
    },
    {
      "size": "32px",
      "count": 1
    }
  ],
  "_layout": {
    "mainW": 1280,
    "viewport": 1280
  }
}
```

### wallet@1280

```json
{
  "pageTitle": {
    "fontSize": "32px",
    "fontWeight": "700",
    "lineHeight": "43.2px"
  },
  "sectionH2": {
    "fontSize": "22px",
    "fontWeight": "700",
    "lineHeight": "29.7px"
  },
  "price": null,
  "financialTotal": {
    "fontSize": "24px",
    "fontWeight": "800",
    "lineHeight": "30px"
  },
  "secondary": {
    "fontSize": "14px",
    "fontWeight": "500",
    "lineHeight": "20.3px"
  },
  "caption": null,
  "trustOrNote": null,
  "_fontSizeHistogram": [
    {
      "size": "11.52px",
      "count": 8
    },
    {
      "size": "12px",
      "count": 1
    },
    {
      "size": "12.48px",
      "count": 4
    },
    {
      "size": "13.12px",
      "count": 6
    },
    {
      "size": "13.3333px",
      "count": 6
    },
    {
      "size": "13.6px",
      "count": 5
    },
    {
      "size": "13.76px",
      "count": 5
    },
    {
      "size": "14px",
      "count": 10
    },
    {
      "size": "14.08px",
      "count": 8
    },
    {
      "size": "14.72px",
      "count": 1
    },
    {
      "size": "16px",
      "count": 61
    },
    {
      "size": "16.8px",
      "count": 1
    },
    {
      "size": "20px",
      "count": 4
    },
    {
      "size": "21.6px",
      "count": 1
    },
    {
      "size": "22px",
      "count": 1
    },
    {
      "size": "24px",
      "count": 1
    },
    {
      "size": "32px",
      "count": 1
    }
  ],
  "_layout": {
    "mainW": 1100,
    "viewport": 1280
  }
}
```

### orders@1280

```json
{
  "pageTitle": {
    "fontSize": "32px",
    "fontWeight": "700",
    "lineHeight": "43.2px"
  },
  "sectionH2": null,
  "price": null,
  "financialTotal": null,
  "secondary": null,
  "caption": null,
  "trustOrNote": null,
  "_fontSizeHistogram": [
    {
      "size": "11.52px",
      "count": 2
    },
    {
      "size": "12px",
      "count": 2
    },
    {
      "size": "12.48px",
      "count": 6
    },
    {
      "size": "13.44px",
      "count": 4
    },
    {
      "size": "13.6px",
      "count": 3
    },
    {
      "size": "14px",
      "count": 2
    },
    {
      "size": "15.2px",
      "count": 3
    },
    {
      "size": "16px",
      "count": 24
    },
    {
      "size": "20px",
      "count": 1
    },
    {
      "size": "20.48px",
      "count": 2
    },
    {
      "size": "32px",
      "count": 1
    }
  ],
  "_layout": {
    "mainW": 1280,
    "viewport": 1280
  }
}
```

## Before → After (key roles)


| Viewport | Role | Before | After |
|----------|------|--------|-------|
| cart@390 | pageTitle | 15px | 18px |
| cart@390 | sectionH2 | 15px | 16px |
| cart@390 | financialTotal | 20px | 20px |
| cart@390 | secondary | 13px | 14px |
| cart@390 | caption | 12px | 12px |
| checkout@390 | pageTitle | 21.6px | 24px |
| checkout@390 | sectionH2 | 16px | 18px |
| checkout@390 | financialTotal | 16.8px | 20px |
| checkout@390 | secondary | 15.2px | 14px |
| wallet@390 | pageTitle | 16.8px | 24px |
| wallet@390 | sectionH2 | 16px | 18px |
| wallet@390 | financialTotal | 32px | 20px |
| wallet@390 | secondary | 13.12px | 14px |
| orders@390 | pageTitle | 19.2px | 24px |
| cart@768 | pageTitle | 17px | 20px |
| cart@768 | sectionH2 | 15px | 18px |
| cart@768 | financialTotal | 20px | 24px |
| cart@768 | secondary | 13px | 14px |
| cart@768 | caption | 12px | 12px |
| checkout@768 | pageTitle | 26.88px | 28px |
| checkout@768 | sectionH2 | 18.4px | 20px |
| checkout@768 | financialTotal | 19.2px | 24px |
| checkout@768 | secondary | 16.8px | 14px |
| wallet@768 | pageTitle | 16.8px | 28px |
| wallet@768 | sectionH2 | 16px | 20px |
| wallet@768 | financialTotal | 42.4px | 24px |
| wallet@768 | secondary | 13.12px | 14px |
| orders@768 | pageTitle | 24px | 28px |
| cart@1280 | pageTitle | 17px | 22px |
| cart@1280 | sectionH2 | 15px | 18px |
| cart@1280 | financialTotal | 20px | 24px |
| cart@1280 | secondary | 13px | 14px |
| cart@1280 | caption | 12px | 12px |
| checkout@1280 | pageTitle | 28px | 32px |
| checkout@1280 | sectionH2 | 18.4px | 22px |
| checkout@1280 | financialTotal | 19.2px | 24px |
| checkout@1280 | secondary | 16.8px | 14px |
| wallet@1280 | pageTitle | 16.8px | 32px |
| wallet@1280 | sectionH2 | 16px | 22px |
| wallet@1280 | financialTotal | 42.4px | 24px |
| wallet@1280 | secondary | 13.12px | 14px |
| orders@1280 | pageTitle | 24px | 32px |

## Layout & Commerce Checks

- Colors: unchanged
- Layout / grid / cards: unchanged
- Form fields (inputs): unchanged
- Payment logic: unchanged
- Mobile Harmony: unchanged on guest-shell pages

## Files

- `public/assets/design-system/erv-typography-pr1-tokens.css` (reused)
- `public/assets/design-system/erv-typography-commerce-pr3-tokens.css`
- `public/assets/design-system/erv-typography-commerce-pr3.css`
- Commerce pages: cart · checkout · wallet · my-orders
