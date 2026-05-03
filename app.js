// ============================================================
// 1. FIREBASE YAPILANDIRMASI
// Projeye ait bağlantı bilgileri.
// Yeni bir firma için sadece bu bloğu güncellemek yeterlidir.
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, getDocs, addDoc, updateDoc, deleteDoc, collection, query, where, orderBy, onSnapshot, serverTimestamp, Timestamp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBlYSJbBnkL-PoPM_VH3uLDBe545awkO04",
  authDomain: "aktepe-94711.firebaseapp.com",
  projectId: "aktepe-94711",
  storageBucket: "aktepe-94711.firebasestorage.app",
  messagingSenderId: "721383862652",
  appId: "1:721383862652:web:dc1de116bacae16f5c74f9"
};

const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const db = getFirestore(app);

// Kullanıcı adını Firebase Auth'un gerektirdiği e-posta formatına çevirir.
// Kullanıcıya hiçbir zaman gösterilmez.
function kuadEmaile(kullaniciAdi) {
  return `${kullaniciAdi.toLowerCase().trim()}@${FIREBASE_CONFIG.projectId}.app`;
}


// ============================================================
// 2. UYGULAMA DURUMU
// Aktif kullanıcı, geçerli sayfa ve arka plan işlemleri için
// merkezi durum nesnesi. Sayfa değişimlerinde temizlenir.
// ============================================================

const durum = {
  kullanici: null,        // { uid, kullaniciAdi, adSoyad, rol }
  sayfa: null,            // aktif sayfa adı
  timerIdler: [],         // aktif masa süre sayaçları
  snapshotTemizle: null,  // aktif Firestore gerçek zamanlı dinleyici
};


// ============================================================
// 3. YARDIMCI FONKSİYONLAR
// Para formatlama, süre hesaplama ve DOM işlemleri için
// tekrar kullanılan küçük fonksiyonlar.
// ============================================================

function paraBicimlendir(tutar) {
  return Number(tutar || 0).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + " ₺";
}

function sureHesapla(acilisMs) {
  const sn = Math.floor((Date.now() - acilisMs) / 1000);
  const s  = Math.floor(sn / 3600).toString().padStart(2, "0");
  const d  = Math.floor((sn % 3600) / 60).toString().padStart(2, "0");
  const ss = (sn % 60).toString().padStart(2, "0");
  return `${s}:${d}:${ss}`;
}

function sureUcretiHesapla(acilisMs, saatlikUcret) {
  if (!saatlikUcret) return 0;
  return ((Date.now() - acilisMs) / 3600000) * saatlikUcret;
}

function bugunBaslangic() {
  const now = new Date();
  const d = new Date(now);
  // 00:00–05:59 arası hâlâ önceki iş gününe ait
  if (now.getHours() < 6) d.setDate(d.getDate() - 1);
  d.setHours(6, 0, 0, 0);
  return Timestamp.fromDate(d);
}

function elem(id) {
  return document.getElementById(id);
}

function temizleTimerlar() {
  durum.timerIdler.forEach(clearInterval);
  durum.timerIdler = [];
}

function temizleListener() {
  if (durum.snapshotTemizle) {
    durum.snapshotTemizle();
    durum.snapshotTemizle = null;
  }
}

function modalKapat() {
  ["masa-modal", "urun-modal", "odeme-modal", "gecmis-modal"].forEach(id => elem(id)?.remove());
}


// ============================================================
// 4. KİMLİK DOĞRULAMA
// Kullanıcı adı + şifre ile giriş ve oturum takibi.
// E-posta adresi sisteme dahil değildir.
// ============================================================

async function girisYap(kullaniciAdi, sifre) {
  await signInWithEmailAndPassword(auth, kuadEmaile(kullaniciAdi), sifre);
}

async function cikisYap() {
  temizleTimerlar();
  temizleListener();
  await signOut(auth);
}


// ============================================================
// 5. ROUTER
// Hash tabanlı sayfa yönlendirme.
// URL'deki # değerine göre ilgili sayfa fonksiyonu çağrılır.
// Sayfa değişiminde timer'lar ve dinleyiciler temizlenir.
// ============================================================

function sayfayaGit(sayfa) {
  window.location.hash = sayfa;
}

function routerBaslat() {
  window.addEventListener("hashchange", () => sayfaGoster(window.location.hash.slice(1)));
  sayfaGoster(window.location.hash.slice(1) || "masalar");
}

function sayfaGoster(sayfa) {
  temizleTimerlar();
  temizleListener();
  durum.sayfa = sayfa;

  document.querySelectorAll(".alt-nav a").forEach(a => {
    a.classList.toggle("aktif", a.dataset.sayfa === sayfa);
  });

  const kapsayici = elem("sayfa-icerigi");
  if (!kapsayici) return;

  switch (sayfa) {
    case "masalar":   return masalarSayfasi(kapsayici);
    case "kasalar":   return kasalarSayfasi(kapsayici);
    case "oyuncular": return oyuncularSayfasi(kapsayici);
    case "yonetim":   return yonetimSayfasi(kapsayici);
    default:          return masalarSayfasi(kapsayici);
  }
}


// ============================================================
// 6. GİRİŞ EKRANI
// Kullanıcı adı ve şifre ile giriş formu.
// Hatalı girişte kullanıcıya mesaj gösterilir.
// ============================================================

function girisEkraniGoster() {
  elem("uygulama").innerHTML = `
    <div class="giris-kapsayici">
      <div class="giris-kart">
        <h1>Bilardo Kasa</h1>
        <form id="giris-form">
          <input type="text" id="giris-kullanici" placeholder="Kullanıcı Adı" autocomplete="username" required />
          <input type="password" id="giris-sifre" placeholder="Şifre" autocomplete="current-password" required />
          <p id="giris-hata" class="hata gizli"></p>
          <button type="submit">Giriş Yap</button>
        </form>
      </div>
    </div>
  `;

  elem("giris-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const hataEl = elem("giris-hata");
    hataEl.classList.add("gizli");
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    btn.textContent = "Giriş yapılıyor...";

    try {
      await girisYap(elem("giris-kullanici").value, elem("giris-sifre").value);
    } catch {
      hataEl.textContent = "Kullanıcı adı veya şifre hatalı.";
      hataEl.classList.remove("gizli");
      btn.disabled = false;
      btn.textContent = "Giriş Yap";
    }
  });
}


// ============================================================
// 7. ANA LAYOUT
// Rol bazlı kenar çubuğu (sidebar) ve sayfa kapsayıcısı.
// Admin tüm menüleri, eleman sadece izin verilenleri görür.
// ============================================================

const NAV_MENULERI = [
  { sayfa: "masalar",   etiket: "Masalar",   ikon: "🎱", roller: ["admin", "eleman"] },
  { sayfa: "kasalar",   etiket: "Kasalar",   ikon: "💰", roller: ["admin"] },
  { sayfa: "oyuncular", etiket: "Oyuncular", ikon: "👥", roller: ["admin", "eleman"] },
  { sayfa: "yonetim",   etiket: "Yönetim",   ikon: "⚙️", roller: ["admin"] },
];

function layoutGoster() {
  const menuHtml = NAV_MENULERI
    .filter(m => m.roller.includes(durum.kullanici.rol))
    .map(m => `<a href="#${m.sayfa}" data-sayfa="${m.sayfa}"><span class="nav-ikon">${m.ikon}</span>${m.etiket}</a>`)
    .join("");

  elem("uygulama").innerHTML = `
    <div class="layout">
      <header class="ust-bar">
        <span class="ust-bar-logo">Bilardo Kasa</span>
        <div class="ust-bar-sag">
          <span class="ust-bar-kullanici">${durum.kullanici.adSoyad}</span>
          <button id="cikis-btn">Çıkış</button>
        </div>
      </header>
      <main class="ana-icerik">
        <div id="sayfa-icerigi"></div>
      </main>
      <nav class="alt-nav">${menuHtml}</nav>
    </div>
  `;

  elem("cikis-btn").addEventListener("click", cikisYap);
  routerBaslat();
}


// ============================================================
// 8. MASALAR SAYFASI
// Masaları kategoriye göre gruplar; süreli kategoriler üstte,
// süresiz altta. Her kategoride aktif masalar öne çekilir.
// Süreli aktif masalarda canlı süre sayacı gösterilir.
// ============================================================

function masalarSayfasi(kapsayici) {
  kapsayici.innerHTML = `
    <div class="sayfa-baslik"><h2>Masalar</h2></div>
    <div id="masalar-grid">Yükleniyor...</div>
  `;

  const masaQ = query(collection(db, "masalar"), orderBy("sira"));
  durum.snapshotTemizle = onSnapshot(masaQ, async (snap) => {
    const masalar = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const katSnap = await getDocs(query(collection(db, "masaKategorileri"), orderBy("sira")));
    const kategoriler = katSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    masalarRenderle(masalar, kategoriler);
  });
}

function masalarRenderle(masalar, kategoriler) {
  temizleTimerlar();
  const grid = elem("masalar-grid");
  if (!grid) return;

  const gruplar = kategoriler
    .map(kat => ({ ...kat, masalar: masalar.filter(m => m.kategoriId === kat.id) }))
    .filter(g => g.masalar.length > 0);

  // Süreli kategoriler üstte, süresiz altta
  const sirali = [
    ...gruplar.filter(g => g.masalar.some(m => m.sureli)),
    ...gruplar.filter(g => g.masalar.every(m => !m.sureli)),
  ];

  if (sirali.length === 0) {
    grid.innerHTML = `<p class="bos-mesaj">Henüz masa eklenmedi. Yönetim Paneli'nden masa ekleyebilirsiniz.</p>`;
    return;
  }

  grid.innerHTML = sirali.map(grup => {
    // Aktif masalar öne
    const masalar = [
      ...grup.masalar.filter(m => m.aktif),
      ...grup.masalar.filter(m => !m.aktif),
    ];
    return `
      <div class="kategori-grup">
        <h3 class="kategori-baslik">${grup.ad}</h3>
        <div class="masa-grid">${masalar.map(m => masaKartiHtml(m, grup.ad)).join("")}</div>
      </div>
    `;
  }).join("");

  // Süreli aktif masalarda sayaç başlat
  masalar.filter(m => m.aktif && m.sureli && m.acilisSaati).forEach(masa => {
    const ms = masa.acilisSaati.toMillis();
    const id = setInterval(() => {
      const el = elem(`sure-${masa.id}`);
      if (el) el.textContent = sureHesapla(ms);
      else clearInterval(id);
    }, 1000);
    durum.timerIdler.push(id);
  });

  // Masa kartı tıklama
  grid.querySelectorAll(".masa-kart").forEach(kart => {
    kart.addEventListener("click", () => {
      const masa = masalar.find(m => m.id === kart.dataset.id);
      if (masa) masaModalAc(masa);
    });
  });
}

function masaKartiHtml(masa, katAd = "") {
  let icerik = "";
  if (masa.aktif) {
    if (masa.sureli && masa.acilisSaati) {
      const ms = masa.acilisSaati.toMillis();
      const saatStr = new Date(ms).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
      icerik = `
        <div class="masa-acilis">Açılış: ${saatStr}</div>
        <div class="masa-sure" id="sure-${masa.id}">${sureHesapla(ms)}</div>
      `;
    } else {
      icerik = `<div class="masa-tutar">${paraBicimlendir(masa.toplamTutar)}</div>`;
    }
  }

  let ikon = "";
  if (masa.sureli) {
    ikon = `<img src="masaicon.jpg" class="masa-kart-ikon" alt="" />`;
  } else if (katAd.toLowerCase().includes("okey")) {
    ikon = `<img src="okeyicon.jpg" class="masa-kart-ikon" alt="" />`;
  }

  return `
    <div class="masa-kart${masa.aktif ? " aktif" : ""}" data-id="${masa.id}">
      <div class="masa-kart-icerik">
        <div class="masa-ad">${masa.ad}</div>
        ${icerik}
      </div>
      ${ikon}
    </div>
  `;
}


// ============================================================
// 9. MASA MODAL
// Masaya tıklanınca açılan menü.
// Boş masa: Masa Aç / Ürün Girişi, Masa Geçmişi.
// Aktif masa: Ürün Girişi, Masa Geçmişi, Masayı Kapat.
// ============================================================

async function masaModalAc(masa) {
  elem("masa-modal")?.remove();

  // Boş süreli masa — sadece Masa Aç göster
  if (!masa.aktif && masa.sureli) {
    const modal = document.createElement("div");
    modal.id = "masa-modal";
    modal.className = "modal-arka-plan";
    modal.innerHTML = `
      <div class="modal-kutu">
        <h3>${masa.ad}</h3>
        <p class="masa-durum-etiketi">Boş</p>
        <div class="modal-butonlar">
          <button id="btn-masa-ac" class="btn-birincil">Masa Aç</button>
          <button id="btn-masa-gecmis" class="btn-ikincil">Geçmiş</button>
          <button id="btn-modal-kapat" class="btn-iptal">İptal</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener("click", e => { if (e.target === modal) modalKapat(); });
    elem("btn-modal-kapat").addEventListener("click", modalKapat);
    elem("btn-masa-gecmis").addEventListener("click", () => { modalKapat(); masaGecmisiGoster(masa); });
    elem("btn-masa-ac").addEventListener("click", () => { modalKapat(); masaAc(masa); });
    return;
  }

  // Aktif masa veya boş süresiz masa — ürün listesi göster
  const [urunSnap, kayitSnap] = await Promise.all([
    getDocs(query(collection(db, "urunler"), orderBy("sira"))),
    getDocs(query(collection(db, "masaKayitlari"), where("masaId", "==", masa.id))),
  ]);
  const urunler = urunSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  let kayitlar = kayitSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.tarih?.toMillis?.() ?? 0) - (b.tarih?.toMillis?.() ?? 0));

  let sureSatiri = "";
  if (masa.aktif && masa.sureli && masa.acilisSaati) {
    const ms = masa.acilisSaati.toMillis();
    sureSatiri = `<p class="masa-modal-sure" id="modal-sure-${masa.id}">Süre: ${sureHesapla(ms)}</p>`;
    const id = setInterval(() => {
      const el = elem(`modal-sure-${masa.id}`);
      if (el) el.textContent = `Süre: ${sureHesapla(ms)}`;
      else clearInterval(id);
    }, 1000);
    durum.timerIdler.push(id);
  }

  const urunGrid = urunler.length > 0
    ? `<div class="urun-grid">${urunler.map(u => `
        <button class="urun-btn" data-id="${u.id}" data-ad="${u.ad}" data-fiyat="${u.fiyat}">
          <span class="urun-btn-ad">${u.ad}</span>
          <span class="urun-btn-fiyat">${paraBicimlendir(u.fiyat)}</span>
        </button>`).join("")}
      </div>`
    : `<p class="bos-mesaj kucuk">Ürün tanımlanmamış. Yönetim → Ürünler bölümünden ekleyin.</p>`;

  const modal = document.createElement("div");
  modal.id = "masa-modal";
  modal.className = "modal-arka-plan";
  modal.innerHTML = `
    <div class="modal-kutu">
      <div class="modal-baslik-satir">
        <h3>${masa.ad}</h3>
        <span class="masa-modal-tutar-badge${masa.aktif ? "" : " gizli"}" id="modal-tutar-badge">${paraBicimlendir(masa.toplamTutar)}</span>
      </div>
      ${sureSatiri}
      ${urunGrid}
      <div id="modal-pending-alan"></div>
      <div id="modal-sepet"></div>
      <div class="modal-butonlar" style="margin-top:12px">
        ${masa.aktif ? `<button id="btn-masa-kapat" class="btn-kapat">Masayı Kapat</button>` : ""}
        <button id="btn-masa-gecmis" class="btn-ikincil">Geçmiş</button>
        <button id="btn-modal-kapat" class="btn-iptal">Kapat</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  let pending = [];

  const sepetYenile = async () => {
    const snap = await getDocs(query(collection(db, "masaKayitlari"), where("masaId", "==", masa.id)));
    kayitlar = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.tarih?.toMillis?.() ?? 0) - (b.tarih?.toMillis?.() ?? 0));
    modalSepetGuncelle(kayitlar, masa, silKayit);
  };

  const silKayit = async (kayitId) => {
    const kayit = kayitlar.find(k => k.id === kayitId);
    if (!kayit) return;
    if (kayit.miktar > 1) {
      await updateDoc(doc(db, "masaKayitlari", kayitId), {
        miktar: kayit.miktar - 1,
        tutar: (kayit.miktar - 1) * kayit.birimFiyat,
      });
    } else {
      await deleteDoc(doc(db, "masaKayitlari", kayitId));
    }
    masa.toplamTutar = Math.max(0, (masa.toplamTutar || 0) - kayit.birimFiyat);
    await updateDoc(doc(db, "masalar", masa.id), { toplamTutar: masa.toplamTutar });
    const badge = elem("modal-tutar-badge");
    if (badge) badge.textContent = paraBicimlendir(masa.toplamTutar);
    await sepetYenile();
  };

  const renderPending = () => {
    const el = elem("modal-pending-alan");
    if (!el) return;
    if (pending.length === 0) { el.innerHTML = ""; return; }

    const gruplu = {};
    pending.forEach(p => {
      if (!gruplu[p.ad]) gruplu[p.ad] = { ad: p.ad, fiyat: p.fiyat, adet: 0 };
      gruplu[p.ad].adet++;
    });
    const pendingToplam = pending.reduce((t, p) => t + p.fiyat, 0);

    el.innerHTML = `
      <div class="modal-pending">
        <div class="pending-chips">
          ${Object.values(gruplu).map(g =>
            `<span class="pending-chip">${g.ad}${g.adet > 1 ? ` ×${g.adet}` : ""}</span>`
          ).join("")}
        </div>
        <div class="pending-butonlar">
          <button id="btn-geri-al" class="btn-ikincil btn-kucuk">← Geri Al</button>
          <button id="btn-onayla" class="btn-birincil btn-kucuk">Ekle (${paraBicimlendir(pendingToplam)})</button>
        </div>
      </div>
    `;

    elem("btn-geri-al").addEventListener("click", () => { pending.pop(); renderPending(); });
    elem("btn-onayla").addEventListener("click", async () => {
      elem("btn-onayla").disabled = true;
      await pendingOnayla();
    });
  };

  const pendingOnayla = async () => {
    if (pending.length === 0) return;
    const gruplu = {};
    pending.forEach(p => {
      if (!gruplu[p.ad]) gruplu[p.ad] = { ad: p.ad, fiyat: p.fiyat, adet: 0 };
      gruplu[p.ad].adet++;
    });

    let eklenecekToplam = 0;
    for (const g of Object.values(gruplu)) {
      const mevcutKayit = kayitlar.find(k => k.ad === g.ad);
      const eklenecek = g.adet * g.fiyat;
      eklenecekToplam += eklenecek;
      if (mevcutKayit) {
        const yeniMiktar = mevcutKayit.miktar + g.adet;
        await updateDoc(doc(db, "masaKayitlari", mevcutKayit.id), {
          miktar: yeniMiktar, tutar: yeniMiktar * mevcutKayit.birimFiyat,
        });
      } else {
        await addDoc(collection(db, "masaKayitlari"), {
          masaId: masa.id, ad: g.ad, miktar: g.adet, birimFiyat: g.fiyat, tutar: eklenecek,
          tarih: serverTimestamp(),
        });
      }
    }

    masa.toplamTutar = (masa.toplamTutar || 0) + eklenecekToplam;
    masa.aktif = true;
    await updateDoc(doc(db, "masalar", masa.id), { aktif: true, toplamTutar: masa.toplamTutar });

    const badge = elem("modal-tutar-badge");
    if (badge) { badge.textContent = paraBicimlendir(masa.toplamTutar); badge.classList.remove("gizli"); }

    if (!elem("btn-masa-kapat")) {
      const butonlar = modal.querySelector(".modal-butonlar");
      const kapBtn = document.createElement("button");
      kapBtn.id = "btn-masa-kapat";
      kapBtn.className = "btn-kapat";
      kapBtn.textContent = "Masayı Kapat";
      butonlar.insertBefore(kapBtn, butonlar.firstChild);
      kapBtn.addEventListener("click", () => { modalKapat(); odemeEkraniAc(masa); });
    }

    pending = [];
    renderPending();
    await sepetYenile();
  };

  modalSepetGuncelle(kayitlar, masa, silKayit);

  modal.addEventListener("click", e => { if (e.target === modal) modalKapat(); });
  elem("btn-modal-kapat").addEventListener("click", modalKapat);
  elem("btn-masa-gecmis").addEventListener("click", () => { modalKapat(); masaGecmisiGoster(masa); });
  elem("btn-masa-kapat")?.addEventListener("click", () => { modalKapat(); odemeEkraniAc(masa); });

  // Ürün butonuna tıkla → pending'e ekle, henüz kaydetme
  modal.querySelectorAll(".urun-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      pending.push({ ad: btn.dataset.ad, fiyat: parseFloat(btn.dataset.fiyat) });
      renderPending();
    });
  });
}

function modalSepetGuncelle(kayitlar, masa, onSil) {
  const el = elem("modal-sepet");
  if (!el) return;
  if (kayitlar.length === 0) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = `
    <div class="modal-sepet">
      ${kayitlar.map(k => `
        <div class="modal-sepet-satir">
          <span>${k.ad}${k.miktar > 1 ? ` × ${k.miktar}` : ""}</span>
          <div class="modal-sepet-sag">
            <span class="modal-sepet-tutar">${paraBicimlendir(k.tutar)}</span>
            <button class="btn-sepet-sil" data-id="${k.id}">✕</button>
          </div>
        </div>`).join("")}
    </div>
  `;
  if (onSil) {
    el.querySelectorAll(".btn-sepet-sil").forEach(btn => {
      btn.addEventListener("click", () => onSil(btn.dataset.id));
    });
  }
}

async function masaAc(masa) {
  await updateDoc(doc(db, "masalar", masa.id), {
    aktif: true, acilisSaati: serverTimestamp(), toplamTutar: 0,
  });
}

async function masaGecmisiGoster(masa) {
  elem("gecmis-modal")?.remove();
  const isAdmin = durum.kullanici?.rol === "admin";

  const hareketleriYukle = async () => {
    const snap = await getDocs(query(
      collection(db, "kasaHareketleri"),
      where("masaId", "==", masa.id)
    ));
    const bugunMs = bugunBaslangic().toMillis();
    const records = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(h => h.tarih && h.tarih.toMillis() >= bugunMs);

    // Kayıtları oturumId'ye göre grupla
    const oturumMap = {};
    records.forEach(r => {
      const key = r.oturumId ?? r.id; // eski format için id'yi key olarak kullan
      if (!oturumMap[key]) oturumMap[key] = [];
      oturumMap[key].push(r);
    });

    return Object.values(oturumMap).map(kayitlar => {
      const ilk = kayitlar[0];

      // Eski format: tek kayıt, içinde urunler[] dizisi var
      if (kayitlar.length === 1 && ilk.urunler) {
        return {
          _kayitIds: [ilk.id], kasaId: ilk.kasaId, tarih: ilk.tarih,
          acilisSaati: ilk.acilisSaati, sureli: ilk.sureli,
          sureUcret: ilk.sureUcret || 0, urunler: ilk.urunler || [],
          urunToplam: ilk.urunToplam || 0,
          hesaplananTutar: ilk.hesaplananTutar ?? ilk.tutar,
          tutar: ilk.tutar,
        };
      }

      // Yeni format: birden fazla kayıt, oturumId ile gruplandı
      const sureKayit   = kayitlar.find(r => r.kategori === "sure");
      const urunKayitlar = kayitlar.filter(r => r.kategori === "urun");
      const duzeltme    = kayitlar.find(r => r.kategori === "duzeltme");

      const sureUcret  = sureKayit?.tutar || 0;
      const urunler    = urunKayitlar.map(r => ({
        ad: r.urunAd, miktar: r.urunMiktar,
        birimFiyat: r.urunBirimFiyat, tutar: r.tutar,
      }));
      const urunToplam     = urunler.reduce((t, u) => t + u.tutar, 0);
      const hesaplananTutar = sureUcret + urunToplam;
      const fark = duzeltme ? (duzeltme.tur === "gelir" ? duzeltme.tutar : -duzeltme.tutar) : 0;

      const enSonTarih = kayitlar.reduce((en, r) =>
        r.tarih.toMillis() > en.toMillis() ? r.tarih : en, kayitlar[0].tarih);

      return {
        _kayitIds: kayitlar.map(r => r.id),
        kasaId: ilk.kasaId, tarih: enSonTarih,
        acilisSaati: ilk.acilisSaati, sureli: ilk.sureli,
        sureUcret, urunler, urunToplam, hesaplananTutar,
        tutar: hesaplananTutar + fark,
      };
    }).sort((a, b) => b.tarih.toMillis() - a.tarih.toMillis());
  };

  const listeYenile = async () => {
    const hareketler = await hareketleriYukle();
    const liste = elem("gecmis-liste-icerik");
    if (!liste) return;

    if (hareketler.length === 0) {
      liste.innerHTML = `<p class="bos-mesaj">Bu masa için geçmiş kayıt bulunamadı.</p>`;
      return;
    }

    const genelToplam = hareketler.reduce((t, h) => t + (h.hesaplananTutar ?? h.tutar), 0);

    liste.innerHTML = hareketler.map(h => {
      const kapanisDt = h.tarih.toDate();
      const kapanisStr = kapanisDt.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
      const tarihStr = kapanisDt.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" });

      let zamanSatiri = `${tarihStr} · Kapanış: ${kapanisStr}`;
      if (h.acilisSaati) {
        const acilisStr = h.acilisSaati.toDate().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
        zamanSatiri = `${tarihStr} · Açılış: ${acilisStr} · Kapanış: ${kapanisStr}`;
        if (h.sureli) {
          const toplamSn = Math.floor((h.tarih.toMillis() - h.acilisSaati.toMillis()) / 1000);
          const saat = Math.floor(toplamSn / 3600);
          const dakika = Math.floor((toplamSn % 3600) / 60);
          const sureStr = `${saat > 0 ? saat + "sa " : ""}${dakika}dk`;
          zamanSatiri += ` · <span class="gecmis-sure">Süre: ${sureStr}</span>`;
        }
      }

      // Ücret dökümü
      const satirlar = [];
      if (h.sureli && h.sureUcret > 0) {
        satirlar.push(`<div class="gecmis-dokim-satir">
          <span>Süre Ücreti</span><span>${paraBicimlendir(h.sureUcret)}</span>
        </div>`);
      }
      if (h.urunler && h.urunler.length > 0) {
        h.urunler.forEach(u => {
          satirlar.push(`<div class="gecmis-dokim-satir">
            <span>${u.ad}${u.miktar > 1 ? ` ×${u.miktar}` : ""}</span>
            <span>${paraBicimlendir(u.tutar)}</span>
          </div>`);
        });
        if (h.urunToplam > 0) {
          satirlar.push(`<div class="gecmis-dokim-satir gecmis-ara-toplam">
            <span>Ürünler Toplamı</span><span>${paraBicimlendir(h.urunToplam)}</span>
          </div>`);
        }
      }
      const dokumHtml = satirlar.length > 0
        ? `<div class="gecmis-dokim">${satirlar.join("")}</div>` : "";

      const toplamFarki = h.tutar !== h.hesaplananTutar
        ? `<div class="gecmis-dokim-satir gecmis-alinan">
            <span>Alınan</span><span>${paraBicimlendir(h.tutar)}</span>
          </div>` : "";

      return `
        <div class="gecmis-satir">
          <div class="gecmis-bilgi">
            <div class="gecmis-zamanlar">${zamanSatiri}</div>
            ${dokumHtml}
            ${toplamFarki}
          </div>
          <div class="gecmis-sag">
            <span class="gecmis-tutar">${paraBicimlendir(h.hesaplananTutar ?? h.tutar)}</span>
            ${isAdmin ? `<button class="btn-gecmis-sil" data-ids='${JSON.stringify(h._kayitIds)}' data-kasa="${h.kasaId}" data-tutar="${h.tutar}">Sil</button>` : ""}
          </div>
        </div>
      `;
    }).join("") + `
      <div class="gecmis-genel-toplam">
        <span>Genel Toplam</span>
        <span>${paraBicimlendir(genelToplam)}</span>
      </div>`;

    if (isAdmin) {
      liste.querySelectorAll(".btn-gecmis-sil").forEach(btn => {
        btn.addEventListener("click", async () => {
          if (!confirm("Bu kayıt silinecek ve kasa bakiyesi düşecek. Emin misiniz?")) return;
          btn.disabled = true;
          const kasaRef = doc(db, "kasalar", btn.dataset.kasa);
          const kasaSnap = await getDoc(kasaRef);
          const mevcutBakiye = kasaSnap.data()?.bakiye || 0;
          await updateDoc(kasaRef, { bakiye: Math.max(0, mevcutBakiye - parseFloat(btn.dataset.tutar)) });
          const ids = JSON.parse(btn.dataset.ids);
          await Promise.all(ids.map(id => deleteDoc(doc(db, "kasaHareketleri", id))));
          await listeYenile();
        });
      });
    }
  };

  const modal = document.createElement("div");
  modal.id = "gecmis-modal";
  modal.className = "modal-arka-plan";
  modal.innerHTML = `
    <div class="modal-kutu">
      <h3>${masa.ad} — Geçmiş</h3>
      <div class="gecmis-liste" id="gecmis-liste-icerik">Yükleniyor...</div>
      <div class="modal-butonlar" style="margin-top:16px">
        <button id="btn-gecmis-kapat" class="btn-iptal">Kapat</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener("click", e => { if (e.target === modal) modal.remove(); });
  elem("btn-gecmis-kapat").addEventListener("click", () => modal.remove());

  await listeYenile();
}


// ============================================================
// 10. ÖDEME EKRANI
// Masayı kapatırken açılır. Hesaplanan toplam tutarı gösterir,
// alınan tutarı ve kasa seçimini alır, onaylanınca masayı
// kapatır ve hareketi kasaya işler.
// ============================================================

async function odemeEkraniAc(masa) {
  const [kasaSnap, kayitSnap] = await Promise.all([
    getDocs(query(collection(db, "kasalar"), orderBy("sira"))),
    getDocs(query(collection(db, "masaKayitlari"), where("masaId", "==", masa.id))),
  ]);
  const kasalar = kasaSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const kayitlar = kayitSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  const acilisMs = masa.acilisSaati ? masa.acilisSaati.toMillis() : null;
  const sureUcret = masa.sureli && acilisMs ? sureUcretiHesapla(acilisMs, masa.saatlikUcret || 0) : 0;
  const urunToplam = kayitlar.reduce((t, k) => t + (k.tutar || 0), 0);
  const genelToplam = sureUcret + urunToplam;

  const urunlerHtml = kayitlar.length > 0
    ? kayitlar.map(k => `
        <div class="odeme-satir odeme-satir-urun">
          <span>${k.ad}${k.miktar > 1 ? ` ×${k.miktar}` : ""}</span>
          <span>${paraBicimlendir(k.tutar)}</span>
        </div>`).join("") +
      `<div class="odeme-satir odeme-ara-toplam">
        <span>Ürünler Toplamı</span>
        <span>${paraBicimlendir(urunToplam)}</span>
      </div>`
    : "";

  const kasaSecenekleri = kasalar.map(k => `<option value="${k.id}">${k.ad}</option>`).join("");

  const modal = document.createElement("div");
  modal.id = "odeme-modal";
  modal.className = "modal-arka-plan";
  modal.innerHTML = `
    <div class="modal-kutu">
      <h3>${masa.ad} — Ödeme</h3>
      <div class="odeme-ozet">
        ${masa.sureli ? `<div class="odeme-satir"><span>Süre Ücreti</span><span>${paraBicimlendir(sureUcret)}</span></div>` : ""}
        ${urunlerHtml}
        <div class="odeme-satir toplam"><span>Toplam</span><span>${paraBicimlendir(genelToplam)}</span></div>
      </div>
      <form id="odeme-form">
        <label>Alınan Tutar <small>(boş bırakılırsa tam tutar alındı sayılır)</small></label>
        <input type="number" id="alinan-tutar" placeholder="${genelToplam.toFixed(2)}" min="0" step="0.01" />
        <label>Kasa</label>
        <select id="kasa-secimi">${kasaSecenekleri}</select>
        <label>Açıklama <small>(isteğe bağlı)</small></label>
        <input type="text" id="odeme-aciklama" />
        <p id="odeme-hata" class="hata gizli"></p>
        <div class="modal-butonlar">
          <button type="submit" class="btn-birincil">Onayla ve Kapat</button>
          <button type="button" id="btn-odeme-iptal" class="btn-iptal">İptal</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);

  modal.addEventListener("click", e => { if (e.target === modal) modal.remove(); });
  elem("btn-odeme-iptal").addEventListener("click", () => modal.remove());

  elem("odeme-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const hataEl = elem("odeme-hata");
    hataEl.classList.add("gizli");
    const alinanRaw = elem("alinan-tutar").value;
    const alinanTutar = alinanRaw ? parseFloat(alinanRaw) : genelToplam;
    const kasaId = elem("kasa-secimi").value;
    const aciklama = elem("odeme-aciklama").value.trim();
    const btn = e.target.querySelector("[type='submit']");
    btn.disabled = true;

    try {
      await masayiKapat(masa, genelToplam, alinanTutar, kasaId, aciklama, sureUcret);
      modal.remove();
    } catch (err) {
      hataEl.textContent = "Hata: " + err.message;
      hataEl.classList.remove("gizli");
      btn.disabled = false;
    }
  });
}

async function masayiKapat(masa, hesaplananTutar, alinanTutar, kasaId, aciklama, sureUcret = 0) {
  const kayitSnap = await getDocs(query(collection(db, "masaKayitlari"), where("masaId", "==", masa.id)));
  const urunler = kayitSnap.docs.map(d => {
    const v = d.data();
    return { ad: v.ad, miktar: v.miktar, birimFiyat: v.birimFiyat, tutar: v.tutar };
  });
  await Promise.all(kayitSnap.docs.map(d => deleteDoc(doc(db, "masaKayitlari", d.id))));

  await updateDoc(doc(db, "masalar", masa.id), {
    aktif: false, acilisSaati: null, toplamTutar: 0,
  });

  // Her kategori ayrı kayıt — analiz için
  const oturumId = `${masa.id}_${Date.now()}`;
  const ortak = {
    kasaId, masaId: masa.id, tur: "gelir",
    oturumId, sureli: masa.sureli || false,
    acilisSaati: masa.acilisSaati || null,
    tarih: serverTimestamp(),
  };

  const yazilacaklar = [];

  if (sureUcret > 0) {
    yazilacaklar.push({ ...ortak, tutar: sureUcret,
      aciklama: `${masa.ad} - Süre Ücreti`, kategori: "sure" });
  }
  for (const u of urunler) {
    if ((u.tutar || 0) > 0) {
      yazilacaklar.push({ ...ortak, tutar: u.tutar,
        aciklama: `${masa.ad} - ${u.ad}`, kategori: "urun",
        urunAd: u.ad, urunMiktar: u.miktar, urunBirimFiyat: u.birimFiyat });
    }
  }
  if (yazilacaklar.length === 0) {
    yazilacaklar.push({ ...ortak, tutar: alinanTutar,
      aciklama: aciklama || `${masa.ad} - masa ödemesi`, kategori: "ozet" });
  }
  const fark = Math.round((alinanTutar - hesaplananTutar) * 100) / 100;
  if (Math.abs(fark) > 0.01) {
    yazilacaklar.push({ ...ortak, tutar: Math.abs(fark),
      tur: fark > 0 ? "gelir" : "gider",
      aciklama: `${masa.ad} - ${fark > 0 ? "Fazla Ödeme" : "İndirim"}`,
      kategori: "duzeltme" });
  }

  await Promise.all(yazilacaklar.map(v => addDoc(collection(db, "kasaHareketleri"), v)));

  const kasaRef = doc(db, "kasalar", kasaId);
  const kasaSnap = await getDoc(kasaRef);
  await updateDoc(kasaRef, { bakiye: (kasaSnap.data()?.bakiye || 0) + alinanTutar });
}


// ============================================================
// 11. KASALAR SAYFASI
// Tüm kasaları alt alta listeler. Her kartta toplam bakiye,
// bugünün geliri, gideri ve net sonucu gösterilir.
// Veresiye kasasında tahsilat ve yazılan veresiye ayrı gösterilir.
// ============================================================

async function kasalarSayfasi(kapsayici) {
  kapsayici.innerHTML = `
    <div class="sayfa-baslik"><h2>Kasalar</h2></div>
    <div id="kasalar-liste">Yükleniyor...</div>
  `;

  const [kasaSnap, hareketSnap] = await Promise.all([
    getDocs(query(collection(db, "kasalar"), orderBy("sira"))),
    getDocs(collection(db, "kasaHareketleri")),
  ]);

  const bugunMs = bugunBaslangic().toMillis();
  const kasalar = kasaSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const hareketler = hareketSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(h => h.tarih && h.tarih.toMillis() >= bugunMs);

  const liste = elem("kasalar-liste");
  liste.innerHTML = kasalar.map(k => kasaKartiHtml(k, hareketler)).join("");

  liste.querySelectorAll(".kasa-kart").forEach(kart => {
    kart.addEventListener("click", () => {
      const kasa = kasalar.find(k => k.id === kart.dataset.id);
      if (kasa) kasaDetayAc(kapsayici, kasa);
    });
  });
}

function kasaKartiHtml(kasa, hareketler) {
  const h = hareketler.filter(x => x.kasaId === kasa.id);
  const gelir = h.filter(x => x.tur === "gelir").reduce((t, x) => t + x.tutar, 0);
  const gider = h.filter(x => x.tur === "gider").reduce((t, x) => t + x.tutar, 0);
  const net = gelir - gider;
  const netClass = net > 0 ? "pozitif" : net < 0 ? "negatif" : "sifir";

  if (kasa.tip === "veresiye") {
    const tahsilat = h.filter(x => x.tur === "tahsilat").reduce((t, x) => t + x.tutar, 0);
    return `
      <div class="kasa-kart" data-id="${kasa.id}">
        <div class="kasa-kart-baslik">${kasa.ad}</div>
        <div class="kasa-bakiye">${paraBicimlendir(kasa.bakiye)}</div>
        <div class="kasa-istatistik">
          <span class="pozitif">Tahsilat: ${paraBicimlendir(tahsilat)}</span>
          <span class="negatif">Veresiye: ${paraBicimlendir(gelir)}</span>
        </div>
      </div>
    `;
  }

  return `
    <div class="kasa-kart" data-id="${kasa.id}">
      <div class="kasa-kart-baslik">${kasa.ad}</div>
      <div class="kasa-bakiye">${paraBicimlendir(kasa.bakiye)}</div>
      <div class="kasa-istatistik">
        <span class="pozitif">Gelir: ${paraBicimlendir(gelir)}</span>
        <span class="negatif">Gider: ${paraBicimlendir(gider)}</span>
        <span class="${netClass}">Net: ${paraBicimlendir(net)}</span>
      </div>
    </div>
  `;
}


// ============================================================
// 12. KASA DETAY
// Tıklanan kasanın kartını üstte gösterir; altında o güne ait
// hareketleri (saat, tür, açıklama, tutar) listeler.
// ============================================================

async function kasaDetayAc(kapsayici, kasa) {
  kapsayici.innerHTML = `
    <div class="sayfa-baslik">
      <button id="btn-geri" class="btn-geri">← Kasalar</button>
      <h2>${kasa.ad}</h2>
    </div>
    <div id="detay-icerik">Yükleniyor...</div>
  `;
  elem("btn-geri").addEventListener("click", () => kasalarSayfasi(kapsayici));

  const snap = await getDocs(query(
    collection(db, "kasaHareketleri"),
    where("kasaId", "==", kasa.id)
  ));
  const bugunMs = bugunBaslangic().toMillis();
  const hareketler = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(h => h.tarih && h.tarih.toMillis() >= bugunMs)
    .sort((a, b) => b.tarih.toMillis() - a.tarih.toMillis());

  const gelir = hareketler.filter(h => h.tur === "gelir").reduce((t, h) => t + h.tutar, 0);
  const gider = hareketler.filter(h => h.tur === "gider").reduce((t, h) => t + h.tutar, 0);

  const satirlar = hareketler.length === 0
    ? `<tr><td colspan="4" class="bos-hucre">Bugün işlem yok</td></tr>`
    : hareketler.map(h => {
        const saat = h.tarih ? h.tarih.toDate().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }) : "—";
        const tur = { gelir: "Gelir", gider: "Gider", tahsilat: "Tahsilat", transfer_giris: "Transfer (+)", transfer_cikis: "Transfer (−)" }[h.tur] ?? h.tur;
        const turClass = ["gelir", "tahsilat", "transfer_giris"].includes(h.tur) ? "pozitif" : "negatif";
        return `<tr>
          <td>${saat}</td>
          <td class="${turClass}">${tur}</td>
          <td>${h.aciklama || "—"}</td>
          <td class="sayi ${turClass}">${paraBicimlendir(h.tutar)}</td>
        </tr>`;
      }).join("");

  elem("detay-icerik").innerHTML = `
    <div class="detay-ozet">
      <div>Bakiye: <strong>${paraBicimlendir(kasa.bakiye)}</strong></div>
      <div>Bugün Gelir: <strong class="pozitif">${paraBicimlendir(gelir)}</strong></div>
      <div>Bugün Gider: <strong class="negatif">${paraBicimlendir(gider)}</strong></div>
    </div>
    <table class="hareket-tablo">
      <thead><tr><th>Saat</th><th>Tür</th><th>Açıklama</th><th>Tutar</th></tr></thead>
      <tbody>${satirlar}</tbody>
    </table>
  `;
}


// ============================================================
// 13. VERESİYE İŞLEMLERİ
// Oyuncuya borç bağlama ve tahsilat.
// Oyuncular modülü tamamlanınca bu bölüm aktif edilecek.
// ============================================================

// TODO: veresiyeTahsilatAc()


// ============================================================
// 14. KASALAR ARASI TRANSFER
// Bakiye hareketi — gelir/gider sayılmaz, sadece aktarım.
// Yönetim Paneli ile birlikte eklenecek.
// ============================================================

// TODO: kasaTransferiAc()


// ============================================================
// 15. RAPOR MODÜLÜ
// Tarih aralığı + kasa + kategori filtreli raporlama.
// Toplam tutarlar tablo üstünde, detay listesi altında.
// Excel (.xlsx) export desteği eklenecek.
// ============================================================

// TODO: raporSayfasi()


// ============================================================
// 16. OYUNCULAR SAYFASI
// Kayıtlı oyuncu listesi, veresiye bakiyesi ve geçmiş.
// Yapım aşamasında.
// ============================================================

function oyuncularSayfasi(kapsayici) {
  kapsayici.innerHTML = `
    <div class="sayfa-baslik"><h2>Oyuncular</h2></div>
    <p class="bos-mesaj">Bu bölüm yapım aşamasındadır.</p>
  `;
}


// ============================================================
// 17. YÖNETİM PANELİ
// Masalar ve kasalar sekmeli olarak yönetilir.
// Admin masa ekleyip silebilir, kasa ekleyip silebilir.
// Nakit, Banka, Veresiye sistem kasaları silinemez.
// ============================================================

const YONETIM_MENUSU = [
  { id: "masalar", etiket: "Masalar",  aciklama: "Masa ekle, sil, ücret güncelle" },
  { id: "kasalar", etiket: "Kasalar",  aciklama: "Kasa ekle, sil" },
  { id: "urunler", etiket: "Ürünler",  aciklama: "Ürün ve fiyat tanımla" },
];

function yonetimSayfasi(kapsayici) {
  kapsayici.innerHTML = `
    <div class="sayfa-baslik"><h2>Yönetim Paneli</h2></div>
    <div class="yonetim-menu">
      ${YONETIM_MENUSU.map(m => `
        <button class="yonetim-menu-satir" data-menu="${m.id}">
          <div>
            <div class="yonetim-menu-etiket">${m.etiket}</div>
            <div class="yonetim-menu-aciklama">${m.aciklama}</div>
          </div>
          <span class="yonetim-menu-ok">›</span>
        </button>
      `).join("")}
    </div>
  `;

  kapsayici.querySelectorAll(".yonetim-menu-satir").forEach(btn => {
    btn.addEventListener("click", () => {
      const menu = btn.dataset.menu;
      if (menu === "masalar") masaYonetimi(kapsayici);
      else if (menu === "kasalar") kasaYonetimi(kapsayici);
      else if (menu === "urunler") urunYonetimi(kapsayici);
    });
  });
}

async function masaYonetimi(kapsayici) {
  const katSnap = await getDocs(query(collection(db, "masaKategorileri"), orderBy("sira")));
  const kategoriler = katSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const katSecenekleri = kategoriler.map(k => `<option value="${k.id}">${k.ad}</option>`).join("");

  kapsayici.innerHTML = `
    <div class="sayfa-baslik">
      <button class="btn-geri" id="btn-yonetim-geri">← Yönetim</button>
      <h2>Masalar</h2>
    </div>
    <div class="yonetim-form-kart">
      <h3>Yeni Masa Ekle</h3>
      <input type="text" id="masa-ad" placeholder="Masa Adı" />
      <select id="masa-kategori">${katSecenekleri}</select>
      <label class="checkbox-label">
        <input type="checkbox" id="masa-sureli" />
        Süreli masa (süre bazlı ücret)
      </label>
      <div id="saatlik-ucret-alan" class="gizli">
        <input type="number" id="masa-saatlik-ucret" placeholder="Saatlik Ücret (₺)" min="0" step="0.01" />
      </div>
      <p id="masa-hata" class="hata gizli"></p>
      <button id="btn-masa-ekle" class="btn-birincil">Ekle</button>
    </div>
    <div id="masa-listesi">Yükleniyor...</div>
  `;

  elem("btn-yonetim-geri").addEventListener("click", () => yonetimSayfasi(kapsayici));
  elem("masa-sureli").addEventListener("change", e => {
    elem("saatlik-ucret-alan").classList.toggle("gizli", !e.target.checked);
  });

  masaListesiYukle();

  elem("btn-masa-ekle").addEventListener("click", async () => {
    const hataEl = elem("masa-hata");
    hataEl.classList.add("gizli");
    const ad = elem("masa-ad").value.trim();
    if (!ad) {
      hataEl.textContent = "Masa adı gerekli.";
      hataEl.classList.remove("gizli");
      return;
    }
    const btn = elem("btn-masa-ekle");
    btn.disabled = true;
    const kategoriId = elem("masa-kategori").value;
    const sureli = elem("masa-sureli").checked;
    const saatlikUcret = sureli ? parseFloat(elem("masa-saatlik-ucret").value || 0) : 0;

    const masaSnap = await getDocs(collection(db, "masalar"));
    const maxSira = masaSnap.docs.reduce((max, d) => Math.max(max, d.data().sira ?? 0), -1);

    try {
      await addDoc(collection(db, "masalar"), {
        ad, kategoriId, sureli, saatlikUcret,
        sira: maxSira + 1,
        aktif: false, acilisSaati: null, toplamTutar: 0,
      });
      elem("masa-ad").value = "";
      elem("masa-saatlik-ucret").value = "";
      elem("masa-sureli").checked = false;
      elem("saatlik-ucret-alan").classList.add("gizli");
      masaListesiYukle();
    } catch (err) {
      hataEl.textContent = "Hata: " + err.message;
      hataEl.classList.remove("gizli");
    }
    btn.disabled = false;
  });
}

async function masaListesiYukle() {
  const el = elem("masa-listesi");
  if (!el) return;

  const [masaSnap, katSnap] = await Promise.all([
    getDocs(query(collection(db, "masalar"), orderBy("sira"))),
    getDocs(collection(db, "masaKategorileri")),
  ]);
  const katAdlari = Object.fromEntries(katSnap.docs.map(d => [d.id, d.data().ad]));
  const masalar = masaSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  if (masalar.length === 0) {
    el.innerHTML = `<p class="bos-mesaj">Henüz masa eklenmedi.</p>`;
    return;
  }

  el.innerHTML = `
    <div class="yonetim-liste">
      ${masalar.map(m => `
        <div class="yonetim-liste-satir" data-id="${m.id}">
          <div style="flex:1">
            <div class="yonetim-liste-ad">${m.ad}</div>
            <div class="yonetim-liste-detay">${katAdlari[m.kategoriId] || "—"} · ${m.sureli ? `Süreli · ${paraBicimlendir(m.saatlikUcret || 0)}/saat` : "Süresiz"}</div>
            ${m.sureli ? `<div class="ucret-duzenle-alan gizli" id="ucret-alan-${m.id}">
              <div class="ucret-duzenle-satir">
                <input type="number" class="ucret-input" id="ucret-${m.id}" value="${m.saatlikUcret || 0}" min="0" step="0.01" placeholder="₺/saat" />
                <button class="btn-kaydet" data-id="${m.id}">Kaydet</button>
                <button class="btn-iptal-ucret" data-id="${m.id}">İptal</button>
              </div>
            </div>` : ""}
          </div>
          <div class="yonetim-satir-butonlar">
            ${m.sureli ? `<button class="btn-ikincil btn-duzenle" data-id="${m.id}">Ücret</button>` : ""}
            ${m.aktif ? `<span class="aktif-etiket">Aktif</span>` : `<button class="btn-sil" data-id="${m.id}">Sil</button>`}
          </div>
        </div>
      `).join("")}
    </div>
  `;

  // Sil
  el.querySelectorAll(".btn-sil").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("Bu masayı silmek istediğinize emin misiniz?")) return;
      await deleteDoc(doc(db, "masalar", btn.dataset.id));
      masaListesiYukle();
    });
  });

  // Ücret düzenle aç/kapat
  el.querySelectorAll(".btn-duzenle").forEach(btn => {
    btn.addEventListener("click", () => {
      const alan = elem(`ucret-alan-${btn.dataset.id}`);
      alan.classList.toggle("gizli");
    });
  });

  // İptal
  el.querySelectorAll(".btn-iptal-ucret").forEach(btn => {
    btn.addEventListener("click", () => {
      elem(`ucret-alan-${btn.dataset.id}`).classList.add("gizli");
    });
  });

  // Kaydet
  el.querySelectorAll(".btn-kaydet").forEach(btn => {
    btn.addEventListener("click", async () => {
      const yeniUcret = parseFloat(elem(`ucret-${btn.dataset.id}`).value);
      if (isNaN(yeniUcret) || yeniUcret < 0) return;
      btn.disabled = true;
      await updateDoc(doc(db, "masalar", btn.dataset.id), { saatlikUcret: yeniUcret });
      masaListesiYukle();
    });
  });
}

async function kasaYonetimi(kapsayici) {
  kapsayici.innerHTML = `
    <div class="sayfa-baslik">
      <button class="btn-geri" id="btn-yonetim-geri-kasa">← Yönetim</button>
      <h2>Kasalar</h2>
    </div>
    <div class="yonetim-form-kart">
      <h3>Yeni Kasa Ekle</h3>
      <input type="text" id="kasa-ad" placeholder="Kasa Adı" />
      <p id="kasa-hata" class="hata gizli"></p>
      <button id="btn-kasa-ekle" class="btn-birincil">Ekle</button>
    </div>
    <div id="kasa-listesi">Yükleniyor...</div>
  `;

  elem("btn-yonetim-geri-kasa").addEventListener("click", () => yonetimSayfasi(kapsayici));
  kasaListesiYukle();

  elem("btn-kasa-ekle").addEventListener("click", async () => {
    const hataEl = elem("kasa-hata");
    hataEl.classList.add("gizli");
    const ad = elem("kasa-ad").value.trim();
    if (!ad) {
      hataEl.textContent = "Kasa adı gerekli.";
      hataEl.classList.remove("gizli");
      return;
    }
    const btn = elem("btn-kasa-ekle");
    btn.disabled = true;

    const kasaSnap = await getDocs(collection(db, "kasalar"));
    const maxSira = kasaSnap.docs.reduce((max, d) => Math.max(max, d.data().sira ?? 0), -1);

    try {
      await addDoc(collection(db, "kasalar"), {
        ad, tip: "normal", silinebilir: true,
        sira: maxSira + 1, bakiye: 0,
      });
      elem("kasa-ad").value = "";
      kasaListesiYukle();
    } catch (err) {
      hataEl.textContent = "Hata: " + err.message;
      hataEl.classList.remove("gizli");
    }
    btn.disabled = false;
  });
}

async function kasaListesiYukle() {
  const el = elem("kasa-listesi");
  if (!el) return;

  const snap = await getDocs(query(collection(db, "kasalar"), orderBy("sira")));
  const kasalar = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  el.innerHTML = `
    <div class="yonetim-liste">
      ${kasalar.map(k => `
        <div class="yonetim-liste-satir">
          <div>
            <div class="yonetim-liste-ad">${k.ad}</div>
            ${!k.silinebilir ? `<div class="yonetim-liste-detay">Sistem kasası</div>` : ""}
          </div>
          ${k.silinebilir ? `<button class="btn-sil" data-id="${k.id}">Sil</button>` : ""}
        </div>
      `).join("")}
    </div>
  `;

  el.querySelectorAll(".btn-sil").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("Bu kasayı silmek istediğinize emin misiniz?")) return;
      await deleteDoc(doc(db, "kasalar", btn.dataset.id));
      kasaListesiYukle();
    });
  });
}


async function urunYonetimi(kapsayici) {
  kapsayici.innerHTML = `
    <div class="sayfa-baslik">
      <button class="btn-geri" id="btn-yonetim-geri-urun">← Yönetim</button>
      <h2>Ürünler</h2>
    </div>
    <div class="yonetim-form-kart">
      <h3>Yeni Ürün Ekle</h3>
      <input type="text" id="urun-ad" placeholder="Ürün Adı (ör: Çay, Kola)" />
      <input type="number" id="urun-fiyat" placeholder="Fiyat (₺)" min="0" step="0.01" />
      <p id="urun-hata" class="hata gizli"></p>
      <button id="btn-urun-ekle" class="btn-birincil">Ekle</button>
    </div>
    <div id="urun-listesi">Yükleniyor...</div>
  `;

  elem("btn-yonetim-geri-urun").addEventListener("click", () => yonetimSayfasi(kapsayici));
  urunListesiYukle();

  elem("btn-urun-ekle").addEventListener("click", async () => {
    const hataEl = elem("urun-hata");
    hataEl.classList.add("gizli");
    const ad = elem("urun-ad").value.trim();
    const fiyat = parseFloat(elem("urun-fiyat").value);

    if (!ad) {
      hataEl.textContent = "Ürün adı gerekli.";
      hataEl.classList.remove("gizli");
      return;
    }
    if (isNaN(fiyat) || fiyat < 0) {
      hataEl.textContent = "Geçerli bir fiyat girin.";
      hataEl.classList.remove("gizli");
      return;
    }

    const btn = elem("btn-urun-ekle");
    btn.disabled = true;

    const snap = await getDocs(collection(db, "urunler"));
    const maxSira = snap.docs.reduce((max, d) => Math.max(max, d.data().sira ?? 0), -1);

    try {
      await addDoc(collection(db, "urunler"), { ad, fiyat, sira: maxSira + 1 });
      elem("urun-ad").value = "";
      elem("urun-fiyat").value = "";
      urunListesiYukle();
    } catch (err) {
      hataEl.textContent = "Hata: " + err.message;
      hataEl.classList.remove("gizli");
    }
    btn.disabled = false;
  });
}

async function urunListesiYukle() {
  const el = elem("urun-listesi");
  if (!el) return;

  const snap = await getDocs(query(collection(db, "urunler"), orderBy("sira")));
  const urunler = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  if (urunler.length === 0) {
    el.innerHTML = `<p class="bos-mesaj">Henüz ürün eklenmedi.</p>`;
    return;
  }

  el.innerHTML = `
    <div class="yonetim-liste">
      ${urunler.map(u => `
        <div class="yonetim-liste-satir">
          <div>
            <div class="yonetim-liste-ad">${u.ad}</div>
            <div class="yonetim-liste-detay">${paraBicimlendir(u.fiyat)}</div>
          </div>
          <button class="btn-sil" data-id="${u.id}">Sil</button>
        </div>
      `).join("")}
    </div>
  `;

  el.querySelectorAll(".btn-sil").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("Bu ürünü silmek istediğinize emin misiniz?")) return;
      await deleteDoc(doc(db, "urunler", btn.dataset.id));
      urunListesiYukle();
    });
  });
}


// ============================================================
// 18. BAŞLATICI
// Sayfa yüklenince kimlik durumunu dinler.
// Oturum açıksa layout'u, kapalıysa giriş ekranını gösterir.
// ============================================================

onAuthStateChanged(auth, async (firebaseUser) => {
  if (!firebaseUser) {
    girisEkraniGoster();
    return;
  }

  const snap = await getDoc(doc(db, "kullanicilar", firebaseUser.uid));
  if (!snap.exists()) {
    await signOut(auth);
    girisEkraniGoster();
    return;
  }

  durum.kullanici = { uid: firebaseUser.uid, ...snap.data() };
  layoutGoster();
});
