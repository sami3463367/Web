/**
 * Boighor BD — Seed data
 * Demo catalogue for a Bangladeshi shop (BDT), a merchant admin account,
 * and ~14 days of order history so the analytics dashboard is meaningful.
 *
 *   npm run seed              # seed only when the DB is empty
 *   npm run seed -- --force   # wipe & re-seed
 */
import { db, get, run, tx, seedSettingsIfEmpty } from './core/db.js';
import { hashPassword } from './core/auth.js';
import { computeTotals } from './lib/money.js';

const CATEGORIES = [
  { slug: 'men', name: "Men's Wear", icon: '👔', sort: 1 },
  { slug: 'women', name: "Women's Wear", icon: '🥻', sort: 2 },
  { slug: 'leather', name: 'Leather Goods', icon: '👜', sort: 3 },
  { slug: 'gadgets', name: 'Gadgets', icon: '🎧', sort: 4 }
];

const img = (key) => [
  { s: `/assets/img/p/${key}-480.webp`, l: `/assets/img/p/${key}-800.webp` }
];

const PRODUCTS = [
  {
    slug: 'premium-cotton-panjabi', category: 'men',
    name: 'Premium Cotton Panjabi — Eid Collection',
    summary: 'Breathable combed cotton with hand-finished gold zari embroidery.',
    description:
      'Cut from premium combed cotton that stays crisp in Dhaka heat, this panjabi features delicate gold zari work along the placket and cuffs. Perfect for Eid prayers, holud ceremonies and Friday gatherings.\n\n• 100% combed cotton, colour-fast dye\n• Traditional straight cut with side slits\n• Machine washable, minimal ironing\n• Model is 5\'10" wearing size L',
    price: 1850, compare_price: 2400, images: img('1-panjabi'),
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    colors: [{ name: 'Emerald', hex: '#0E5B43' }, { name: 'Midnight', hex: '#1B2440' }, { name: 'Ivory', hex: '#F1E8D8' }],
    stock: 24, rating: 4.8, rating_count: 214, sold: 412, featured: 1
  },
  {
    slug: 'genuine-leather-oxford-shoes', category: 'men',
    name: 'Genuine Leather Oxford Shoes',
    summary: 'Full-grain Bangladeshi leather, hand-stitched, office ready.',
    description:
      'Handcrafted in Dhaka from full-grain cow leather with a cushioned insole and anti-slip TPR sole. Breaks in beautifully and ages with character.\n\n• Full-grain leather upper & lining\n• Hand-stitched welt construction\n• Cushioned memory-foam insole\n• Fits true to size',
    price: 2450, compare_price: 3200, images: img('2-shoes'),
    sizes: ['39', '40', '41', '42', '43', '44'],
    colors: [{ name: 'Tan', hex: '#8B5A2B' }, { name: 'Black', hex: '#1A1A1A' }],
    stock: 12, rating: 4.6, rating_count: 96, sold: 168, featured: 1
  },
  {
    slug: 'jamdani-half-silk-saree', category: 'women',
    name: 'Jamdani Half-Silk Saree (Rupganj)',
    summary: 'Handwoven Rupganj jamdani with intricate floral motifs.',
    description:
      'A heritage piece handwoven by Rupganj artisans over several days. The half-silk body carries fine floral buti motifs with a richly ornate aanchal border.\n\n• Handwoven half-silk, 5.5 metres + blouse piece\n• Traditional jamdani buti & par border\n• Each piece is unique — slight variation is a mark of handloom\n• Dry clean recommended',
    price: 3450, compare_price: 4500, images: img('3-saree'),
    sizes: ['Free Size'],
    colors: [{ name: 'Maroon', hex: '#7A1F2B' }, { name: 'Teal', hex: '#0F6B66' }],
    stock: 7, rating: 4.9, rating_count: 58, sold: 74, featured: 1
  },
  {
    slug: 'cotton-three-piece-kurti-set', category: 'women',
    name: 'Cotton 3-Piece Kurti Set (Block Print)',
    summary: 'Soft cotton kurti, salwar & dupatta in hand block prints.',
    description:
      'An everyday-elegant three piece set in soft, pre-washed cotton with hand block printed florals. Includes kurti, salwar and matching dupatta.\n\n• Kurti: straight cut, side pockets\n• Salwar: semi-patiala with drawstring\n• Dupatta: 2.2 m matching block print\n• Colour-fast, machine washable',
    price: 1650, compare_price: 2100, images: img('4-kurti'),
    sizes: ['S', 'M', 'L', 'XL'],
    colors: [{ name: 'Powder Blue', hex: '#A9C6D9' }, { name: 'Blush', hex: '#E8B4B8' }],
    stock: 18, rating: 4.7, rating_count: 132, sold: 240, featured: 1
  },
  {
    slug: 'handcrafted-leather-wallet', category: 'leather',
    name: 'Handcrafted Genuine Leather Wallet',
    summary: 'Bifold wallet, 8 card slots, RFID-safe lining.',
    description:
      'A slim bifold cut from vegetable-tanned leather that develops a rich patina. Eight card slots, two hidden pockets and a full-length note compartment.\n\n• Vegetable-tanned full-grain leather\n• RFID-blocking lining\n• 8 card slots + 2 slip pockets\n• Gift box included',
    price: 1290, compare_price: 1650, images: img('5-wallet'),
    sizes: [],
    colors: [{ name: 'Tan', hex: '#A9713A' }, { name: 'Black', hex: '#1A1A1A' }, { name: 'Chocolate', hex: '#4B2E1E' }],
    stock: 30, rating: 4.8, rating_count: 301, sold: 520, featured: 1
  },
  {
    slug: 'leather-crossbody-bag', category: 'leather',
    name: 'Leather Crossbody Bag — Mustard',
    summary: 'Structured crossbody in pebbled leather with gold hardware.',
    description:
      'A structured everyday crossbody in pebbled genuine leather with an adjustable strap and gold-tone hardware. Fits a 6.7" phone, wallet and compact umbrella.\n\n• Pebbled genuine leather\n• Adjustable & detachable strap\n• Magnetic flap + inner zip pocket\n• Dimensions: 22 × 15 × 8 cm',
    price: 2150, compare_price: 2700, images: img('6-bag'),
    sizes: [],
    colors: [{ name: 'Mustard', hex: '#D9A413' }, { name: 'Burgundy', hex: '#6E1423' }],
    stock: 0, rating: 4.5, rating_count: 44, sold: 61, featured: 0
  },
  {
    slug: 'tws-bluetooth-earbuds-pro', category: 'gadgets',
    name: 'TWS Bluetooth Earbuds Pro (ENC)',
    summary: '40h playtime, ENC calls, Type-C fast charge, IPX5.',
    description:
      'Crystal-clear calls with quad-mic ENC, deep bass 13mm drivers and 40 hours of total playtime. Pairs instantly with any phone.\n\n• Bluetooth 5.3, 13mm drivers\n• 40h total playtime, Type-C fast charge\n• IPX5 sweat & splash resistant\n• Touch controls + voice assistant',
    price: 1490, compare_price: 2200, images: img('7-earbuds'),
    sizes: [],
    colors: [{ name: 'Matte Black', hex: '#1C1C1E' }, { name: 'Pearl White', hex: '#EDEDF0' }],
    stock: 40, rating: 4.4, rating_count: 187, sold: 356, featured: 1
  },
  {
    slug: 'powerbank-20000mah-fast-charge', category: 'gadgets',
    name: '20000mAh Power Bank (22.5W Fast Charge)',
    summary: 'Charges 3 devices at once, LED % display, airline safe.',
    description:
      'Never run flat during load-shedding or long journeys. 22.5W fast charge with dual USB-A + USB-C PD, and a digital display showing exact battery %.\n\n• 20,000mAh lithium-polymer cell\n• 22.5W PD + QC 3.0 fast charging\n• Charges 3 devices simultaneously\n• 12-layer circuit protection',
    price: 1890, compare_price: 2400, images: img('8-powerbank'),
    sizes: [],
    colors: [{ name: 'Space Grey', hex: '#5A5F66' }, { name: 'Ocean Blue', hex: '#1F4E79' }],
    stock: 3, rating: 4.6, rating_count: 143, sold: 208, featured: 0
  }
];

const BD_NAMES = [
  'Rafiq Islam', 'Nusrat Jahan', 'Tanvir Ahmed', 'Sumaiya Akter', 'Mehedi Hasan',
  'Farhana Rahman', 'Sabbir Hossain', 'Taslima Begum', 'Arif Chowdhury', 'Mim Sultana',
  'Kamrul Hasan', 'Rima Das', 'Jahirul Islam', 'Sharmin Sultana', 'Polash Kumar'
];
const BD_AREAS = [
  'House 12, Road 5, Dhanmondi, Dhaka', 'Flat 3B, Green Road, Dhaka',
  'Bashundhara R/A, Block C, Dhaka', 'Chawkbazar, Chittagong', 'Zindabazar, Sylhet',
  'Kazir Dewri, Mirpur 10, Dhaka', 'New Market area, Rajshahi', 'Uttara Sector 7, Dhaka',
  'Nimtoli, Old Dhaka', 'GEC circle, Chittagong', 'Banani 11, Dhaka', 'Khulna Sonadanga'
];

/* deterministic pseudo-random so re-seeds are reproducible */
let _s = 20260909;
const rnd = () => ((_s = (_s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const between = (a, b) => a + Math.floor(rnd() * (b - a + 1));

function orderCode(date, seq) {
  const d = new Date(date);
  const yy = String(d.getUTCFullYear()).slice(2);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `BD-${yy}${mm}${dd}-${String(seq).padStart(4, '0')}`;
}

export function seed({ force = false } = {}) {
  const existing = get('SELECT COUNT(*) AS c FROM products').c;
  if (existing > 0 && !force) return false;

  tx(() => {
    if (force) {
      db.exec(`DELETE FROM order_items; DELETE FROM orders; DELETE FROM products;
               DELETE FROM categories; DELETE FROM users; DELETE FROM sessions; DELETE FROM settings;`);
      db.exec(`DELETE FROM sqlite_sequence WHERE name IN ('order_items','orders','products','categories','users');`);
    }
    seedSettingsIfEmpty();

    for (const c of CATEGORIES) {
      run('INSERT INTO categories(slug,name,icon,sort) VALUES(?,?,?,?)', c.slug, c.name, c.icon, c.sort);
    }
    const catId = {};
    for (const c of CATEGORIES) catId[c.slug] = get('SELECT id FROM categories WHERE slug=?', c.slug).id;

    for (const p of PRODUCTS) {
      run(
        `INSERT INTO products(slug,category_id,name,summary,description,price,compare_price,images,sizes,colors,stock,low_stock_at,rating,rating_count,sold,featured,status)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'active')`,
        p.slug, catId[p.category], p.name, p.summary, p.description, p.price, p.compare_price,
        JSON.stringify(p.images), JSON.stringify(p.sizes), JSON.stringify(p.colors),
        p.stock, 5, p.rating, p.rating_count, p.sold, p.featured
      );
    }

    /* accounts */
    run(
      `INSERT INTO users(name,phone,email,password_hash,address,role) VALUES(?,?,?,?,?, 'admin')`,
      'Merchant Admin', '01700000000', 'admin@boighor.bd', hashPassword('admin123'),
      'Shop 42, Level 3, Bashundhara City, Dhaka'
    );
    run(
      `INSERT INTO users(name,phone,email,password_hash,address,role) VALUES(?,?,?,?,?, 'customer')`,
      'Demo Customer', '01712345678', 'demo@boighor.bd', hashPassword('demo123'),
      'House 7, Road 11, Banani, Dhaka'
    );

    /* ~14 days of order history for the analytics dashboard */
    const products = db.prepare('SELECT id, name, price, sizes, colors FROM products').all();
    let seq = 0;
    for (let daysAgo = 14; daysAgo >= 0; daysAgo--) {
      const ordersToday = daysAgo === 0 ? between(1, 2) : between(1, 4);
      for (let i = 0; i < ordersToday; i++) {
        seq += 1;
        const lineCount = between(1, 3);
        const lines = [];
        const chosen = new Set();
        for (let l = 0; l < lineCount; l++) {
          const p = pick(products);
          if (chosen.has(p.id)) continue;
          chosen.add(p.id);
          const sizes = JSON.parse(p.sizes || '[]');
          const colors = JSON.parse(p.colors || '[]');
          const variant = [sizes.length ? pick(sizes) : '', colors.length ? pick(colors).name : ''].filter(Boolean).join(' / ');
          lines.push({ product: p, variant, qty: between(1, 2), unitPrice: p.price });
        }
        if (!lines.length) continue;
        const zone = rnd() < 0.62 ? 'dhaka' : 'outside';
        const totals = computeTotals(
          lines.map((l) => ({ unitPrice: l.unitPrice, qty: l.qty })), zone
        );
        /* stamp each order inside its own UTC day so the 14-day chart
           always has contiguous history, regardless of when seeding runs */
        const nowD = new Date();
        let date;
        if (daysAgo === 0) {
          const midnight = Date.UTC(nowD.getUTCFullYear(), nowD.getUTCMonth(), nowD.getUTCDate());
          const maxJitterMin = Math.min(300, Math.floor((Date.now() - midnight) / 60000));
          date = new Date(Date.now() - between(0, Math.max(0, maxJitterMin)) * 60000);
        } else {
          date = new Date(Date.UTC(
            nowD.getUTCFullYear(), nowD.getUTCMonth(), nowD.getUTCDate() - daysAgo,
            10 + between(0, 8), between(0, 59)
          ));
        }
        const iso = date.toISOString().replace('T', ' ').slice(0, 19);
        const status = daysAgo === 0 ? 'pending'
          : daysAgo <= 2 ? pick(['pending', 'confirmed', 'confirmed'])
          : daysAgo <= 6 ? pick(['confirmed', 'shipped', 'shipped'])
          : pick(['delivered', 'delivered', 'delivered', 'cancelled']);
        const name = pick(BD_NAMES);
        const phone = `01${pick(['7', '8', '9'])}${String(between(10000000, 99999999))}`;
        const res = run(
          `INSERT INTO orders(code,user_id,customer_name,customer_phone,customer_address,zone,subtotal,delivery_fee,discount,total,status,channel,created_at,updated_at)
           VALUES(?,NULL,?,?,?,?,?,?,?,?,?, 'whatsapp', ?, ?)`,
          orderCode(date, seq), name, phone, pick(BD_AREAS), zone,
          totals.subtotal, totals.delivery_fee, 0, totals.total, status, iso, iso
        );
        const orderId = Number(res.lastInsertRowid);
        for (const l of lines) {
          run(
            'INSERT INTO order_items(order_id,product_id,product_name,variant,qty,unit_price) VALUES(?,?,?,?,?,?)',
            orderId, l.product.id, l.product.name, l.variant, l.qty, l.unitPrice
          );
        }
      }
    }
  });
  return true;
}

/* CLI entry */
if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  const did = seed({ force: process.argv.includes('--force') });
  console.log(did ? '✅ Database seeded.' : 'ℹ️  Database already has products — skipping (use --force to re-seed).');
  process.exit(0);
}
