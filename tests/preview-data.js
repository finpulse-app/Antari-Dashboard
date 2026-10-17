"use strict";
// Synthetic, read-only design/test fixture. Never uses production credentials or customer records.
function createPreviewData() {
  const stores = [
    {
      store_name: "Cedar Market",
      zip: "11235",
      category: "Market",
      delivery_route: "South Brooklyn",
    },
    {
      store_name: "Ararat Bakery",
      zip: "11229",
      category: "Bakery",
      delivery_route: "South Brooklyn",
    },
    {
      store_name: "Orchard Fine Foods",
      zip: "11230",
      category: "Market",
      delivery_route: "Midwood",
    },
    {
      store_name: "Willow Deli",
      zip: "11223",
      category: "Deli",
      delivery_route: "South Brooklyn",
    },
    {
      store_name: "Maple Provisions",
      zip: "11204",
      category: "Market",
      delivery_route: "Borough Park",
    },
    {
      store_name: "Juniper Kitchen",
      zip: "11214",
      category: "Restaurant",
      delivery_route: "Bensonhurst",
    },
    {
      store_name: "Olive & Grain",
      zip: "11218",
      category: "Bakery",
      delivery_route: "Kensington",
    },
    {
      store_name: "Eastwood Market",
      zip: "11364",
      category: "Market",
      delivery_route: "Queens",
    },
  ];
  const products = [
    "Apricot preserve",
    "Armenian lavash",
    "Walnut sujukh",
    "Wildflower honey",
    "Rosehip tea",
  ];
  const months = ["2026-06", "2026-07", "2026-08"];
  const mappedRows = months.flatMap((month, m) =>
    stores.map((s, i) => ({
      id: m * stores.length + i + 1,
      zoho_name: s.store_name,
      mapped_store: s.store_name,
      sales: Math.round((2100 - i * 170) * (1 + m * 0.12)),
      invoice_count: 5 + (i % 3),
      period_start: month + "-01",
      period_end: month + "-" + (m === 0 ? "30" : "31"),
      import_batch_id: m + 1,
    })),
  );
  const itemRows = months.flatMap((month, m) =>
    products.map((item_name, i) => ({
      id: m * products.length + i + 1,
      item_name,
      sku: `ANT-${100 + i}`,
      sales: (4200 - i * 420) * (1 + m * 0.1),
      quantity_sold: (350 - i * 30) * (1 + m * 0.1),
      period_start: month + "-01",
      period_end: month + "-" + (m === 0 ? "30" : "31"),
    })),
  );
  const payments = months.flatMap((month, m) =>
    stores.map((s, i) => ({
      id: m * 8 + i + 1,
      zoho_name: s.store_name,
      mapped_store: s.store_name,
      amount: 650 + i * 65,
      payment_date: month + "-" + String(10 + i * 2).padStart(2, "0"),
      invoice_number: `INV-${m + 1}${100 + i}`,
      payment_mode: "Bank Transfer",
    })),
  );
  const balances = stores
    .slice(0, 3)
    .map((s, i) => ({
      id: i + 1,
      as_of_date: "2026-09-30",
      zoho_name: s.store_name,
      outstanding_balance: [1820, 1240, 960][i],
    }));
  const open = balances.map((b) => ({
    balance_id: b.id,
    as_of_date: b.as_of_date,
    zoho_name: b.zoho_name,
    mapped_store: b.zoho_name,
    snapshot_balance: b.outstanding_balance,
    paid_since_snapshot: 0,
    outstanding_balance: b.outstanding_balance,
  }));
  const sum = (rows, k) => rows.reduce((a, r) => a + Number(r[k] || 0), 0);
  const storeRank = stores
    .map((s) => ({
      ...s,
      total_revenue: sum(
        mappedRows.filter((r) => r.mapped_store === s.store_name),
        "sales",
      ),
      invoices: sum(
        mappedRows.filter((r) => r.mapped_store === s.store_name),
        "invoice_count",
      ),
      last_payment_date: "2026-08-24",
    }))
    .sort((a, b) => b.total_revenue - a.total_revenue)
    .map((s, i) => ({ ...s, revenue_rank: i + 1 }));
  const prodRank = products
    .map((item_name) => ({
      item_name,
      total_revenue: sum(
        itemRows.filter((r) => r.item_name === item_name),
        "sales",
      ),
      units_sold: sum(
        itemRows.filter((r) => r.item_name === item_name),
        "quantity_sold",
      ),
    }))
    .map((p, i) => ({ ...p, revenue_rank: i + 1 }));
  const src = months.flatMap((month) =>
    ["wholesale", "festival", "items"].map((source) => ({
      source,
      month: month + "-01",
      status: "complete",
      revenue:
        source === "wholesale"
          ? sum(
              mappedRows.filter((r) => r.period_start.startsWith(month)),
              "sales",
            )
          : source === "items"
            ? sum(
                itemRows.filter((r) => r.period_start.startsWith(month)),
                "sales",
              )
            : 2800,
      units:
        source === "items"
          ? sum(
              itemRows.filter((r) => r.period_start.startsWith(month)),
              "quantity_sold",
            )
          : 200,
      invoices: 48,
    })),
  );
  return {
    stores,
    v_store_ranking: storeRank,
    v_product_ranking: prodRank,
    v_accounts_receivable: open.map((r) => ({
      store_name: r.mapped_store,
      outstanding_balance: r.outstanding_balance,
    })),
    v_zip_ranking: [...new Set(stores.map((s) => s.zip))].map((zip, i) => ({
      zip,
      total_revenue: sum(
        storeRank.filter((r) => r.zip === zip),
        "total_revenue",
      ),
      revenue_rank: i + 1,
    })),
    v_route_summary: [...new Set(stores.map((s) => s.delivery_route))].map(
      (delivery_route) => ({
        delivery_route,
        stores_on_route: stores.filter(
          (s) => s.delivery_route === delivery_route,
        ).length,
        total_revenue: sum(
          storeRank.filter((r) => r.delivery_route === delivery_route),
          "total_revenue",
        ),
      }),
    ),
    v_channel_summary: [
      { channel: "Wholesale", net_revenue: sum(mappedRows, "sales") },
      { channel: "Direct / Festival", net_revenue: 8400 },
    ],
    v_other_bucket: [{ total_revenue: 0, invoices: 0 }],
    v_monthly_wholesale: src.filter((r) => r.source === "wholesale"),
    v_monthly_festival: src.filter((r) => r.source === "festival"),
    v_monthly_ar: [{ as_of_date: "2026-09-30", total_outstanding: 4020 }],
    v_monthly_payments: months.map((month) => ({
      month: month + "-01",
      collected: sum(
        payments.filter((r) => r.payment_date.startsWith(month)),
        "amount",
      ),
    })),
    zip_demographics: [],
    zip_ancestry: [],
    v_payments_mapped: payments,
    v_sales_customer_mapped: mappedRows,
    v_open_balances: open,
    sales_item: itemRows,
    festival_sales: months.map((month) => ({
      id: month,
      period_start: month + "-01",
      period_end: month + "-" + (month.endsWith("06") ? "30" : "31"),
    })),
    v_source_months: src,
    v_customer_months: mappedRows.map((r) => ({
      customer: r.mapped_store,
      is_listed: true,
      month: r.period_start,
      status: "complete",
      revenue: r.sales,
      invoices: r.invoice_count,
    })),
    v_product_months: itemRows.map((r) => ({
      item_name: r.item_name,
      sku: r.sku,
      month: r.period_start,
      status: "complete",
      revenue: r.sales,
      units: r.quantity_sold,
    })),
    customer_balances: balances,
    v_payment_log: [],
    v_unresolved_names: [],
    name_mapping: [],
    import_batches: months.map((month, i) => ({
      id: i + 1,
      report_type: "sales_customer",
      period_start: month + "-01",
      period_end: month + "-" + (i === 0 ? "30" : "31"),
      file_name: `Sample sales ${month}.pdf`,
      rows_in_file: 8,
      rows_added: 8,
      rows_skipped: 0,
      source_total: sum(
        mappedRows.filter((r) => r.period_start.startsWith(month)),
        "sales",
      ),
      parsed_total: sum(
        mappedRows.filter((r) => r.period_start.startsWith(month)),
        "sales",
      ),
      reconciliation: "pass",
      imported_at: month + "-28T12:00:00Z",
      imported_by_email: "Sample owner",
    })),
  };
}
function createPreviewClient(data = createPreviewData()) {
  const session = { user: { id: "preview", email: "Design preview" } };
  return {
    auth: {
      onAuthStateChange() {
        return { data: { subscription: { unsubscribe() {} } } };
      },
      async getSession() {
        return { data: { session } };
      },
      async signOut() {
        return { error: null };
      },
      async signInWithPassword() {
        return { data: { session }, error: null };
      },
    },
    from(name) {
      let start = 0,
        end = Infinity;
      const query = {
        select() {
          return this;
        },
        order() {
          return this;
        },
        limit(n) {
          end = n - 1;
          return this;
        },
        range(a, b) {
          start = a;
          end = b;
          return this;
        },
        then(resolve, reject) {
          return Promise.resolve({
            data: (data[name] || []).slice(start, end + 1),
            error: null,
          }).then(resolve, reject);
        },
        async insert() {
          return {
            error: { message: "Writes are disabled in design preview." },
          };
        },
        async upsert() {
          return {
            error: { message: "Writes are disabled in design preview." },
          };
        },
      };
      return query;
    },
    async rpc(name) {
      return name === "is_owner"
        ? { data: true, error: null }
        : {
            data: null,
            error: { message: "Writes are disabled in design preview." },
          };
    },
  };
}
