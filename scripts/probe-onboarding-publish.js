#!/usr/bin/env node
/**
 * تحقق سيناريوهات المرحلة 1 عبر Postgres مباشرة ثم يحذف الصفوف التجريبية.
 */
require("dotenv").config();
const { Client } = require("pg");
const {
  storeRowIsListedActive,
  approveStorePatch,
  rejectStorePatch,
  needsInfoStorePatch,
  resubmitOnboardingPatch,
  publishStorePatch,
  validatePublishReadiness,
} = require("../shared/utils/storePublication");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const c = new Client({
    connectionString: process.env.SUPABASE_DB_URL || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();
  const stamp = Date.now();
  const restPhone = "050" + String(stamp).slice(-7);
  const shopPhone = "051" + String(stamp).slice(-7);
  const ids = [];
  try {
    const restIns = await c.query(
      `insert into stores (name, phone, type, status, is_active, publication_status, commercial_registration, lat, lng, address)
       values ($1,$2,'restaurant','pending', false, 'draft', '7000000001', 24.7136, 46.6753, 'probe riyadh')
       returning id, name, type, status, is_active, publication_status, lat, lng`,
      ["مطعم بروبنش " + stamp, restPhone]
    );
    const shopIns = await c.query(
      `insert into stores (name, phone, type, status, is_active, publication_status, commercial_registration, lat, lng, address)
       values ($1,$2,'supermarket','pending', false, 'draft', '7000000002', 21.3891, 39.8579, 'probe jeddah')
       returning id, name, type, status, is_active, publication_status`,
      ["متجر بروبنش " + stamp, shopPhone]
    );
    const rest = restIns.rows[0];
    const shop = shopIns.rows[0];
    ids.push(rest.id, shop.id);
    console.log("1 restaurant pending", rest.id, rest.status, rest.publication_status);
    console.log("2 store pending", shop.id, shop.status, shop.publication_status);
    assert(!storeRowIsListedActive(rest), "pending restaurant listed");
    assert(!storeRowIsListedActive(shop), "pending store listed");

    const niPatch = needsInfoStorePatch("أرفق صورة الرخصة بوضوح");
    const ni = (
      await c.query(
        `update stores set status=$2, is_active=$3, publication_status=$4, needs_info_message=$5, needs_info_at=$6
         where id=$1
         returning id, status, needs_info_message, publication_status, is_active`,
        [rest.id, niPatch.status, niPatch.is_active, niPatch.publication_status, niPatch.needs_info_message, niPatch.needs_info_at]
      )
    ).rows[0];
    console.log("4 needs_info", ni.status, ni.needs_info_message);
    assert(ni.status === "needs_info", "needs_info");
    assert(!storeRowIsListedActive(ni), "needs_info listed");

    const rsPatch = resubmitOnboardingPatch();
    const resub = (
      await c.query(
        `update stores set status=$2, is_active=$3, publication_status=$4, needs_info_message=null
         where id=$1 returning id, status`,
        [rest.id, rsPatch.status, rsPatch.is_active, rsPatch.publication_status]
      )
    ).rows[0];
    assert(resub.status === "pending" && resub.id === rest.id, "same row resubmit");

    const rjPatch = rejectStorePatch();
    const rej = (
      await c.query(
        `update stores set status=$2, is_active=$3, publication_status=$4 where id=$1
         returning id, status, is_active, publication_status`,
        [shop.id, rjPatch.status, rjPatch.is_active, rjPatch.publication_status]
      )
    ).rows[0];
    console.log("5 reject", rej.status, rej.publication_status);
    assert(rej.status === "rejected", "reject");
    assert(!storeRowIsListedActive(rej), "reject listed");

    const apPatch = approveStorePatch();
    const appr = (
      await c.query(
        `update stores set status=$2, is_active=$3, publication_status=$4, needs_info_message=null where id=$1
         returning id, name, type, status, is_active, publication_status, lat, lng`,
        [rest.id, apPatch.status, apPatch.is_active, apPatch.publication_status]
      )
    ).rows[0];
    console.log("6 approve draft", appr.status, appr.publication_status, "active", appr.is_active);
    assert(appr.status === "approved", "approved");
    assert(appr.publication_status === "draft", "not published on approve");
    assert(!storeRowIsListedActive(appr), "approved draft listed");

    const readyBad = validatePublishReadiness(appr, { banner_url: "x" }, [{ name: "كبسة", price: 25, active: true }]);
    assert(!readyBad.ok, "restaurant missing cuisine should fail");
    const readyOk = validatePublishReadiness(
      { ...appr, category: "kabsa_bukhari", logo_url: "logo.jpg" },
      { banner_url: "x" },
      [{ name: "كبسة", price: 25, active: true }]
    );
    assert(readyOk.ok, "min complete failed: " + readyOk.missing.join(","));

    await c.query(`insert into store_products (store_id, name, price, active) values ($1,'كبسة بروبنش',25,true)`, [rest.id]);

    const pbPatch = publishStorePatch();
    const pub = (
      await c.query(
        `update stores set publication_status=$2, is_active=$3, category='kabsa_bukhari' where id=$1
         returning id, status, publication_status, is_active, type`,
        [rest.id, pbPatch.publication_status, pbPatch.is_active]
      )
    ).rows[0];
    console.log("8 publish", pub.status, pub.publication_status);
    assert(storeRowIsListedActive(pub), "published not listed");

    const prod = await c.query(`select id, name, price, active from store_products where store_id=$1`, [rest.id]);
    assert(prod.rows.length >= 1 && Number(prod.rows[0].price) > 0, "product missing");
    console.log("9 product on published store", prod.rows[0].name, prod.rows[0].price);
    console.log("10 no wallet/order writes");
    console.log("PROBE_OK");
  } finally {
    if (ids.length) {
      await c.query(`delete from store_products where store_id = any($1::uuid[])`, [ids]);
      await c.query(`delete from stores where id = any($1::uuid[])`, [ids]);
      console.log("cleaned", ids.length);
    }
    await c.end();
  }
}

main().catch((e) => {
  console.error("[probe] FAIL:", e.message || e);
  process.exit(1);
});
