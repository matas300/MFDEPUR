if (process.env.NODE_ENV === 'production') {
  console.error('❌ seed.js non è eseguibile in produzione. NODE_ENV=production rifiutato.');
  process.exit(1);
}

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
require('dotenv').config();

const prisma = require('../src/config/database');

async function main() {
  console.log('🌱 Seeding database...');

  // ── Admin user ────────────────────────────────────────────────────────────
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@mfdepur.com';
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword || adminPassword.length < 10) {
    console.error('❌ ADMIN_PASSWORD non impostata o troppo corta (min 10 char). Aborto.');
    process.exit(1);
  }

  // Password per le aziende demo: env var o generata random a runtime
  const demoCompanyPassword = process.env.SEED_DEMO_PASSWORD || crypto.randomBytes(12).toString('base64');
  console.log(`ℹ️  Password demo company generata: ${demoCompanyPassword}`);

  const existing = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!existing) {
    await prisma.user.create({
      data: {
        email: adminEmail,
        password: await bcrypt.hash(adminPassword, 12),
        firstName: 'Admin',
        lastName: 'MF Depur',
        role: 'ADMIN',
        isEmailVerified: true,
      },
    });
    console.log(`✅ Admin creato: ${adminEmail}`);
  } else {
    console.log(`ℹ️  Admin già esistente: ${adminEmail}`);
  }

  // ── Categorie ─────────────────────────────────────────────────────────────
  const categories = [
    {
      name: 'Polielettroliti per Acque Reflue',
      slug: 'polielettroliti-acque-reflue',
      description: 'Flocculanti e coagulanti per il trattamento delle acque reflue industriali.',
      sortOrder: 1,
    },
    {
      name: 'Additivi Generatori di Vapore',
      slug: 'additivi-generatori-vapore',
      description: 'Prodotti per il trattamento delle caldaie a vapore industriali.',
      sortOrder: 2,
    },
    {
      name: 'Chemicals Circuiti di Raffreddamento',
      slug: 'chemicals-circuiti-raffreddamento',
      description: 'Trattamenti chimici per torri di raffreddamento e circuiti chiusi.',
      sortOrder: 3,
    },
    {
      name: 'Trattamenti Membrane RO',
      slug: 'trattamenti-membrane-ro',
      description: 'Prodotti per la manutenzione e il trattamento delle membrane a osmosi inversa.',
      sortOrder: 4,
    },
  ];

  for (const cat of categories) {
    await prisma.category.upsert({
      where: { slug: cat.slug },
      update: {},
      create: cat,
    });
  }
  console.log(`✅ ${categories.length} categorie create`);

  // ── Prodotti sample ───────────────────────────────────────────────────────
  const [catReflue, catVapore, catRaff, catRO] = await Promise.all([
    prisma.category.findUnique({ where: { slug: 'polielettroliti-acque-reflue' } }),
    prisma.category.findUnique({ where: { slug: 'additivi-generatori-vapore' } }),
    prisma.category.findUnique({ where: { slug: 'chemicals-circuiti-raffreddamento' } }),
    prisma.category.findUnique({ where: { slug: 'trattamenti-membrane-ro' } }),
  ]);

  const sampleProducts = [
    // ── Polielettroliti per Acque Reflue ─────────────────────────────────────
    {
      name: 'Polielettrolita Cationico MF-C200',
      slug: 'polielettrolita-cationico-mf-c200',
      shortDesc: 'Flocculante cationico in polvere ad alta carica per fanghi biologici',
      description: 'Il MF-C200 è un polielettrolita cationico in polvere ad alta densità di carica, ideale per la disidratazione di fanghi biologici e misti. Garantisce ottime performance nei sistemi a nastro e centrifuga.',
      price: 3.50,
      sku: 'MF-C200',
      stock: 500,
      unit: 'kg',
      minOrderQty: 25,
      lowStockAlert: 100,
      features: [
        'Alta efficienza di flocculazione',
        'Compatibile con sistemi a nastro e centrifuga',
        'Disponibile in sacchi da 25 kg',
        'Certificato per uso industriale',
      ],
      categoryId: catReflue.id,
      isFeatured: true,
    },
    {
      name: 'Polielettrolita Anionico MF-A150',
      slug: 'polielettrolita-anionico-mf-a150',
      shortDesc: 'Flocculante anionico per acque di processo e reflui industriali',
      description: 'MF-A150 è un polielettrolita anionico ad alto peso molecolare in polvere, particolarmente efficace nel trattamento di reflui con elevato contenuto di solidi sospesi. Ideale per chiarificatori e sedimentatori.',
      price: 3.20,
      sku: 'MF-A150',
      stock: 350,
      unit: 'kg',
      minOrderQty: 25,
      lowStockAlert: 75,
      features: [
        'Alto peso molecolare per flocchi voluminosi e rapidi',
        'Efficace su reflui con solidi sospesi elevati',
        'Ottima compatibilità con coagulanti inorganici',
        'Sacchi da 25 kg',
      ],
      categoryId: catReflue.id,
    },
    {
      name: 'Polielettrolita Cationico Liquido MF-CL400',
      slug: 'polielettrolita-cationico-liquido-mf-cl400',
      shortDesc: 'Flocculante cationico liquido pronto all\'uso per dosaggio automatico',
      description: 'MF-CL400 è un polielettrolita cationico in soluzione acquosa, pronto all\'uso, ideale per impianti dotati di sistemi di dosaggio automatico. Elimina i rischi legati alla preparazione delle soluzioni da polvere.',
      price: 1.85,
      sku: 'MF-CL400',
      stock: 2000,
      unit: 'L',
      minOrderQty: 200,
      lowStockAlert: 400,
      features: [
        'Pronto all\'uso, nessuna preparazione necessaria',
        'Compatibile con pompe dosatrici standard',
        'Minimo rischio di polveri e inalazioni',
        'Fusti da 200 L o IBC da 1000 L',
      ],
      categoryId: catReflue.id,
    },
    {
      name: 'Coagulante Inorganico MF-FEC30',
      slug: 'coagulante-inorganico-mf-fec30',
      shortDesc: 'Solfato ferroso al 30% per coagulazione primaria',
      description: 'MF-FEC30 è una soluzione di cloruro ferrico al 30% per la coagulazione primaria di reflui civili e industriali. Ottima efficacia nella rimozione di fosforo e solidi colloidali.',
      price: 0.42,
      sku: 'MF-FEC30',
      stock: 10000,
      unit: 'kg',
      minOrderQty: 1000,
      lowStockAlert: 2000,
      features: [
        'Elevata efficacia nella defosforazione',
        'Compatibile con polielettroliti anionici',
        'Consegna in cisternette IBC o autobotte',
        'Adatto a reflui civili e industriali',
      ],
      categoryId: catReflue.id,
    },

    // ── Additivi Generatori di Vapore ─────────────────────────────────────────
    {
      name: 'Trattamento Caldaia MF-V100',
      slug: 'trattamento-caldaia-mf-v100',
      shortDesc: 'Additivo all-in-one per caldaie a vapore fino a 20 bar',
      description: 'MF-V100 è un additivo multifunzionale per caldaie a vapore a bassa e media pressione (fino a 20 bar). Combina in un\'unica formulazione sequestranti, disperdenti e ammine neutralizzanti per proteggere l\'intero circuito vapore-condensa.',
      price: 4.90,
      sku: 'MF-V100',
      stock: 800,
      unit: 'kg',
      minOrderQty: 50,
      lowStockAlert: 100,
      features: [
        'Formula all-in-one: sequestrante + disperdente + ammina neutralizzante',
        'Adatto a caldaie fino a 20 bar',
        'Protegge il circuito vapore e condensa dalla corrosione',
        'Facile dosaggio tramite pompa volumetrica',
      ],
      categoryId: catVapore.id,
      isFeatured: true,
    },
    {
      name: 'Antiossigeno per Caldaie MF-V200',
      slug: 'antiossigeno-caldaie-mf-v200',
      shortDesc: 'Eliminatore di ossigeno disciolto per la prevenzione della corrosione',
      description: 'MF-V200 è un sequestrante dell\'ossigeno disciolto a base di DEHA (dietilidrossilamina), adatto a caldaie ad alta pressione dove è richiesta la massima protezione dalla corrosione per pitting.',
      price: 8.70,
      sku: 'MF-V200',
      stock: 300,
      unit: 'kg',
      minOrderQty: 25,
      lowStockAlert: 50,
      features: [
        'Eliminazione rapida dell\'ossigeno disciolto',
        'A base di DEHA, volatile e non contaminante',
        'Adatto ad alta pressione (> 20 bar)',
        'Compatibile con MF-V100 per trattamenti combinati',
      ],
      categoryId: catVapore.id,
    },
    {
      name: 'Formulazione Personalizzata Caldaia',
      slug: 'formulazione-personalizzata-caldaia',
      shortDesc: 'Additivo caldaia su specifica del cliente',
      description: 'Formulazione personalizzata in base alle analisi dell\'acqua di alimentazione, alla pressione di esercizio e alle caratteristiche dell\'impianto. Contattaci con i dati dell\'analisi dell\'acqua e del circuito per ricevere un preventivo.',
      price: 0,
      sku: 'MF-VCUSTOM',
      stock: 999,
      unit: 'kg',
      minOrderQty: 100,
      priceOnRequest: true,
      features: [
        'Formulazione studiata sul tuo impianto specifico',
        'Richiede analisi dell\'acqua di alimentazione',
        'Supporto tecnico incluso nella fornitura',
        'Minimo 100 kg per ordine personalizzato',
      ],
      categoryId: catVapore.id,
    },

    // ── Chemicals Circuiti di Raffreddamento ──────────────────────────────────
    {
      name: 'Inibitore di Corrosione MF-R100',
      slug: 'inibitore-corrosione-mf-r100',
      shortDesc: 'Trattamento multiuso per circuiti di raffreddamento aperti e chiusi',
      description: 'MF-R100 è un inibitore di corrosione e antiscalante per circuiti di raffreddamento aperti e chiusi. Protegge acciaio al carbonio, ghisa, rame e leghe di alluminio. Formula priva di cromo e fosfati.',
      price: 5.20,
      sku: 'MF-R100',
      stock: 1200,
      unit: 'kg',
      minOrderQty: 50,
      lowStockAlert: 150,
      features: [
        'Protegge metalli misti: acciaio, rame, alluminio',
        'Formula senza cromo né fosfati (eco-compatibile)',
        'Adatto a circuiti aperti e chiusi',
        'Dosaggio: 200–400 ppm in base alla durezza dell\'acqua',
      ],
      categoryId: catRaff.id,
      isFeatured: true,
    },
    {
      name: 'Biocida Non Ossidante MF-R210',
      slug: 'biocida-non-ossidante-mf-r210',
      shortDesc: 'Biocida a base di isotiazoloni per il controllo microbiologico',
      description: 'MF-R210 è un biocida non ossidante a base di CMIT/MIT per il controllo di batteri, alghe e funghi nelle torri di raffreddamento e nei circuiti chiusi. Efficace su biofouling e Legionella.',
      price: 11.40,
      sku: 'MF-R210',
      stock: 400,
      unit: 'kg',
      minOrderQty: 25,
      lowStockAlert: 50,
      features: [
        'Efficace contro batteri (inclusa Legionella), alghe e funghi',
        'Compatibile con inibitori di corrosione standard',
        'Da alternare con biocidi ossidanti per prevenire resistenze',
        'Scheda sicurezza e protocollo di dosaggio inclusi',
      ],
      categoryId: catRaff.id,
    },
    {
      name: 'Antiscalante e Disperdente MF-R300',
      slug: 'antiscalante-disperdente-mf-r300',
      shortDesc: 'Previene depositi di carbonato e solfato di calcio nelle torri di raffreddamento',
      description: 'MF-R300 è un antiscalante polimerico ad alto rendimento per la prevenzione di incrostazioni da carbonato di calcio, solfato di calcio e ossidi di ferro. Ottimale per acqua con elevata durezza e alcalinità.',
      price: 3.80,
      sku: 'MF-R300',
      stock: 900,
      unit: 'kg',
      minOrderQty: 50,
      lowStockAlert: 100,
      features: [
        'Inibisce carbonato di calcio, solfato di calcio e silice',
        'Disperde ossidi di ferro e fango',
        'Consente cicli di concentrazione elevati',
        'Compatibile con ipoclorito e biocidi non ossidanti',
      ],
      categoryId: catRaff.id,
    },

    // ── Trattamenti Membrane RO ───────────────────────────────────────────────
    {
      name: 'Antiscalante Membrane RO MF-M100',
      slug: 'antiscalante-membrane-ro-mf-m100',
      shortDesc: 'Antiscalante polimerico per sistemi ad osmosi inversa e nanofiltrazione',
      description: 'MF-M100 è un antiscalante/dispersante per membrane RO e NF. Previene la precipitazione di sali insolubili (carbonato di calcio, solfato di bario e stronzio, fluoruro di calcio) sulle membrane, prolungandone la vita utile.',
      price: 9.60,
      sku: 'MF-M100',
      stock: 600,
      unit: 'kg',
      minOrderQty: 25,
      lowStockAlert: 50,
      features: [
        'Efficace contro carbonato, solfato di bario e fluoruro di calcio',
        'LSI negativo senza trattamento dell\'acqua in ingresso',
        'Dosaggio tipico: 2–5 ppm sull\'alimentazione',
        'Compatibile con membrane di tutti i principali produttori',
      ],
      categoryId: catRO.id,
      isFeatured: true,
    },
    {
      name: 'Detergente Alcalino Membrane MF-M200',
      slug: 'detergente-alcalino-membrane-mf-m200',
      shortDesc: 'Detergente CIP alcalino per biofouling e fouling organico su membrane RO',
      description: 'MF-M200 è un detergente alcalino per la pulizia in-situ (CIP) di membrane RO e UF colpite da biofouling e fouling organico. La formulazione a pH elevato scioglie e disperde biofilm, proteine e colloidi organici.',
      price: 7.30,
      sku: 'MF-M200',
      stock: 250,
      unit: 'kg',
      minOrderQty: 25,
      lowStockAlert: 50,
      features: [
        'Rimuove biofouling, proteine e colloidi organici',
        'pH soluzione di lavaggio: 11–12',
        'Temperatura di pulizia consigliata: 35°C',
        'Compatibile con membrane poliammidiche',
      ],
      categoryId: catRO.id,
    },
    {
      name: 'Detergente Acido Membrane MF-M300',
      slug: 'detergente-acido-membrane-mf-m300',
      shortDesc: 'Detergente CIP acido per incrostazioni inorganiche su membrane RO',
      description: 'MF-M300 è un detergente acido per la pulizia in-situ di membrane RO colpite da scaling inorganico (carbonato di calcio, ossidi metallici, silice). Formulato con acidi organici e inibitori di corrosione per proteggere le membrane durante il lavaggio.',
      price: 6.80,
      sku: 'MF-M300',
      stock: 200,
      unit: 'kg',
      minOrderQty: 25,
      lowStockAlert: 40,
      features: [
        'Rimuove incrostazioni da carbonato, ossidi di ferro e manganese',
        'pH soluzione di lavaggio: 2–3',
        'Inibitore di corrosione integrato per proteggere le superfici metalliche',
        'Da usare in alternanza con MF-M200 per pulizie complete',
      ],
      categoryId: catRO.id,
    },
    {
      name: 'Kit Avviamento Impianto RO',
      slug: 'kit-avviamento-impianto-ro',
      shortDesc: 'Set completo di prodotti per il primo avviamento di un impianto ad osmosi inversa',
      description: 'Pacchetto su misura composto da antiscalante, biocida di passivazione e detergente per il primo avviamento dell\'impianto. Quantità e formulazioni vengono definite dal nostro tecnico in base alla portata, al numero di membrane e all\'analisi dell\'acqua.',
      price: 0,
      sku: 'MF-MKIT',
      stock: 99,
      unit: 'kit',
      minOrderQty: 1,
      priceOnRequest: true,
      features: [
        'Prodotti inclusi: MF-M100, MF-M200, MF-M300',
        'Quantità calcolate sul tuo impianto specifico',
        'Sopralluogo tecnico e protocollo di avviamento inclusi',
        'Supporto telefonico durante le prime settimane di esercizio',
      ],
      categoryId: catRO.id,
    },
  ];

  for (const prod of sampleProducts) {
    await prisma.product.upsert({
      where: { slug: prod.slug },
      update: {},
      create: prod,
    });
  }
  console.log(`✅ ${sampleProducts.length} prodotti sample creati`);

  // ── Aziende mock ──────────────────────────────────────────────────────────
  const mockCompanies = [
    {
      company: {
        name: 'Acquatech S.r.l.',
        vatNumber: 'IT09876543210',
        fiscalCode: '09876543210',
        sdiCode: 'ABCDEF1',
        pec: 'acquatech@pec.it',
        phone: '+39 02 1234567',
        website: 'https://acquatech.it',
        status: 'APPROVED',
      },
      user: {
        email: 'mario.rossi@acquatech.it',
        password: demoCompanyPassword,
        firstName: 'Mario',
        lastName: 'Rossi',
        phone: '+39 333 1234567',
      },
    },
    {
      company: {
        name: 'Industrie Depurazione Nord S.p.A.',
        vatNumber: 'IT01122334455',
        fiscalCode: '01122334455',
        sdiCode: 'XYZ1234',
        pec: 'depnord@pec.it',
        phone: '+39 011 9876543',
        status: 'PENDING',
      },
      user: {
        email: 'giulia.bianchi@depnord.it',
        password: demoCompanyPassword,
        firstName: 'Giulia',
        lastName: 'Bianchi',
        phone: '+39 347 9876543',
      },
    },
  ];

  for (const mock of mockCompanies) {
    const existingUser = await prisma.user.findUnique({ where: { email: mock.user.email } });
    if (!existingUser) {
      const company = await prisma.company.upsert({
        where: { vatNumber: mock.company.vatNumber },
        update: {},
        create: mock.company,
      });
      await prisma.user.create({
        data: {
          ...mock.user,
          password: await bcrypt.hash(mock.user.password, 12),
          isEmailVerified: true,
          companyId: company.id,
        },
      });
      console.log(`✅ Azienda mock creata: ${mock.company.name} (${mock.company.status})`);
    } else {
      console.log(`ℹ️  Azienda mock già esistente: ${mock.company.name}`);
    }
  }

  // ── Indirizzi di spedizione ───────────────────────────────────────────────
  const acquatech = await prisma.company.findUnique({ where: { vatNumber: 'IT09876543210' } });
  const marioUser = await prisma.user.findUnique({ where: { email: 'mario.rossi@acquatech.it' } });

  if (acquatech && marioUser) {
    const existingOrders = await prisma.order.count({ where: { companyId: acquatech.id } });
    if (existingOrders === 0) {
      // Crea indirizzo di spedizione
      const address = await prisma.address.upsert({
        where: { id: 'addr-acquatech-sede' },
        update: {},
        create: {
          id: 'addr-acquatech-sede',
          companyId: acquatech.id,
          label: 'Sede operativa',
          street: 'Via dell\'Industria 42',
          city: 'Brescia',
          province: 'BS',
          postalCode: '25121',
          country: 'IT',
          isDefault: true,
        },
      });

      const addressMagazzino = await prisma.address.upsert({
        where: { id: 'addr-acquatech-magazzino' },
        update: {},
        create: {
          id: 'addr-acquatech-magazzino',
          companyId: acquatech.id,
          label: 'Magazzino',
          street: 'Via Logistica 8',
          city: 'Bergamo',
          province: 'BG',
          postalCode: '24122',
          country: 'IT',
          isDefault: false,
        },
      });

      // Recupera prodotti per gli ordini
      const prodC200 = await prisma.product.findUnique({ where: { sku: 'MF-C200' } });
      const prodA150 = await prisma.product.findUnique({ where: { sku: 'MF-A150' } });
      const prodV100 = await prisma.product.findUnique({ where: { sku: 'MF-V100' } });
      const prodR100 = await prisma.product.findUnique({ where: { sku: 'MF-R100' } });
      const prodM100 = await prisma.product.findUnique({ where: { sku: 'MF-M100' } });
      const prodM200 = await prisma.product.findUnique({ where: { sku: 'MF-M200' } });
      const prodM300 = await prisma.product.findUnique({ where: { sku: 'MF-M300' } });
      const prodFEC30 = await prisma.product.findUnique({ where: { sku: 'MF-FEC30' } });
      const prodR210 = await prisma.product.findUnique({ where: { sku: 'MF-R210' } });

      // ── Ordine 1: DELIVERED (consegnato 2 settimane fa) ─────────────────────
      const order1Subtotal = (3.50 * 100) + (3.20 * 75); // 350 + 240 = 590
      const order1Tax = +(order1Subtotal * 0.22).toFixed(2);
      const order1Total = +(order1Subtotal + order1Tax).toFixed(2);

      await prisma.order.create({
        data: {
          orderNumber: 'ORD-2026-0001',
          userId: marioUser.id,
          companyId: acquatech.id,
          addressId: address.id,
          status: 'DELIVERED',
          paymentMethod: 'BANK_TRANSFER',
          subtotal: order1Subtotal,
          taxRate: 0.22,
          taxAmount: order1Tax,
          shippingCost: 0,
          total: order1Total,
          notes: 'Consegna al piano terra, ingresso merci.',
          paidAt: new Date('2026-02-28T10:00:00Z'),
          shippedAt: new Date('2026-03-01T14:00:00Z'),
          deliveredAt: new Date('2026-03-03T09:30:00Z'),
          createdAt: new Date('2026-02-27T08:15:00Z'),
          items: {
            create: [
              {
                productId: prodC200.id,
                productName: prodC200.name,
                productSku: prodC200.sku,
                unit: prodC200.unit,
                quantity: 100,
                unitPrice: 3.50,
                total: 350,
              },
              {
                productId: prodA150.id,
                productName: prodA150.name,
                productSku: prodA150.sku,
                unit: prodA150.unit,
                quantity: 75,
                unitPrice: 3.20,
                total: 240,
              },
            ],
          },
        },
      });
      console.log('✅ Ordine ORD-2026-0001 (DELIVERED)');

      // ── Ordine 2: SHIPPED (spedito, in transito) ────────────────────────────
      const order2Subtotal = (4.90 * 200) + (5.20 * 100); // 980 + 520 = 1500
      const order2Tax = +(order2Subtotal * 0.22).toFixed(2);
      const order2Total = +(order2Subtotal + order2Tax).toFixed(2);

      await prisma.order.create({
        data: {
          orderNumber: 'ORD-2026-0002',
          userId: marioUser.id,
          companyId: acquatech.id,
          addressId: addressMagazzino.id,
          status: 'SHIPPED',
          paymentMethod: 'STRIPE',
          paymentIntentId: 'pi_mock_abc123def456',
          subtotal: order2Subtotal,
          taxRate: 0.22,
          taxAmount: order2Tax,
          shippingCost: 45,
          total: +(order2Total + 45).toFixed(2),
          notes: 'Consegna al magazzino di Bergamo. Chiamare prima della consegna.',
          trackingNumber: 'BRT-1234567890',
          paidAt: new Date('2026-03-10T11:30:00Z'),
          shippedAt: new Date('2026-03-12T08:00:00Z'),
          createdAt: new Date('2026-03-10T11:25:00Z'),
          items: {
            create: [
              {
                productId: prodV100.id,
                productName: prodV100.name,
                productSku: prodV100.sku,
                unit: prodV100.unit,
                quantity: 200,
                unitPrice: 4.90,
                total: 980,
              },
              {
                productId: prodR100.id,
                productName: prodR100.name,
                productSku: prodR100.sku,
                unit: prodR100.unit,
                quantity: 100,
                unitPrice: 5.20,
                total: 520,
              },
            ],
          },
        },
      });
      console.log('✅ Ordine ORD-2026-0002 (SHIPPED)');

      // ── Ordine 3: CONFIRMED (pagato, in lavorazione) ────────────────────────
      const order3Subtotal = (9.60 * 50) + (7.30 * 50) + (6.80 * 50); // 480 + 365 + 340 = 1185
      const order3Tax = +(order3Subtotal * 0.22).toFixed(2);
      const order3Total = +(order3Subtotal + order3Tax).toFixed(2);

      await prisma.order.create({
        data: {
          orderNumber: 'ORD-2026-0003',
          userId: marioUser.id,
          companyId: acquatech.id,
          addressId: address.id,
          status: 'CONFIRMED',
          paymentMethod: 'BANK_TRANSFER',
          subtotal: order3Subtotal,
          taxRate: 0.22,
          taxAmount: order3Tax,
          shippingCost: 0,
          total: order3Total,
          adminNotes: 'Bonifico ricevuto e verificato. Preparare per spedizione.',
          paidAt: new Date('2026-03-16T09:00:00Z'),
          createdAt: new Date('2026-03-14T16:45:00Z'),
          items: {
            create: [
              {
                productId: prodM100.id,
                productName: prodM100.name,
                productSku: prodM100.sku,
                unit: prodM100.unit,
                quantity: 50,
                unitPrice: 9.60,
                total: 480,
              },
              {
                productId: prodM200.id,
                productName: prodM200.name,
                productSku: prodM200.sku,
                unit: prodM200.unit,
                quantity: 50,
                unitPrice: 7.30,
                total: 365,
              },
              {
                productId: prodM300.id,
                productName: prodM300.name,
                productSku: prodM300.sku,
                unit: 'kg',
                quantity: 50,
                unitPrice: 6.80,
                total: 340,
              },
            ],
          },
        },
      });
      console.log('✅ Ordine ORD-2026-0003 (CONFIRMED)');

      // ── Ordine 4: PENDING (appena effettuato, in attesa di pagamento) ───────
      const order4Subtotal = (0.42 * 2000) + (11.40 * 50); // 840 + 570 = 1410
      const order4Tax = +(order4Subtotal * 0.22).toFixed(2);
      const order4Total = +(order4Subtotal + order4Tax).toFixed(2);

      await prisma.order.create({
        data: {
          orderNumber: 'ORD-2026-0004',
          userId: marioUser.id,
          companyId: acquatech.id,
          addressId: address.id,
          status: 'PENDING',
          paymentMethod: 'BANK_TRANSFER',
          subtotal: order4Subtotal,
          taxRate: 0.22,
          taxAmount: order4Tax,
          shippingCost: 0,
          total: order4Total,
          notes: 'Urgente, serve per impianto in avviamento.',
          createdAt: new Date('2026-03-18T14:20:00Z'),
          items: {
            create: [
              {
                productId: prodFEC30.id,
                productName: prodFEC30.name,
                productSku: prodFEC30.sku,
                unit: prodFEC30.unit,
                quantity: 2000,
                unitPrice: 0.42,
                total: 840,
              },
              {
                productId: prodR210.id,
                productName: prodR210.name,
                productSku: prodR210.sku,
                unit: prodR210.unit,
                quantity: 50,
                unitPrice: 11.40,
                total: 570,
              },
            ],
          },
        },
      });
      console.log('✅ Ordine ORD-2026-0004 (PENDING)');

      // ── Ordine 5: CANCELLED (annullato dal cliente) ─────────────────────────
      const order5Subtotal = (3.50 * 50);
      const order5Tax = +(order5Subtotal * 0.22).toFixed(2);
      const order5Total = +(order5Subtotal + order5Tax).toFixed(2);

      await prisma.order.create({
        data: {
          orderNumber: 'ORD-2026-0005',
          userId: marioUser.id,
          companyId: acquatech.id,
          addressId: address.id,
          status: 'CANCELLED',
          paymentMethod: 'STRIPE',
          subtotal: order5Subtotal,
          taxRate: 0.22,
          taxAmount: order5Tax,
          shippingCost: 0,
          total: order5Total,
          notes: 'Annullato: ordine duplicato per errore.',
          createdAt: new Date('2026-03-05T10:00:00Z'),
          items: {
            create: [
              {
                productId: prodC200.id,
                productName: prodC200.name,
                productSku: prodC200.sku,
                unit: prodC200.unit,
                quantity: 50,
                unitPrice: 3.50,
                total: 175,
              },
            ],
          },
        },
      });
      console.log('✅ Ordine ORD-2026-0005 (CANCELLED)');

      console.log('✅ 5 ordini simulati creati con successo');
    } else {
      console.log(`ℹ️  Ordini già esistenti per Acquatech (${existingOrders}), skip`);
    }
  }

  console.log('\n📋 Credenziali aziende mock (password generata a runtime):');
  console.log(`   mario.rossi@acquatech.it / ${demoCompanyPassword}  → APPROVATA`);
  console.log(`   giulia.bianchi@depnord.it / ${demoCompanyPassword} → IN ATTESA`);

  console.log('\n🎉 Seed completato!');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
