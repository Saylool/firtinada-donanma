# ⚓ Fırtınada Donanma — Online 3D Yelkenli Savaş Gemisi Oyunu

Tarayıcıda çalışan, **tamamen prosedürel** (dışarıdan model / texture / 3D kütüphanesi yok) çok oyunculu deniz savaşı.
Saf WebGL2 + JavaScript. Sadece online oda için WebRTC aracı olarak PeerJS (CDN'den) kullanılır.

**Oyna:** Vercel adresini aç → *Hızlı oyun* (yapay zekâya karşı) veya *Online oda kur* / *Odaya katıl*.

## Özellikler
* **4 gemi sınıfı**: Şalopa (küçük/çevik), Fırkateyn, Hattı Harp Gemisi, Birinci Sınıf Kalyon. Her biri gerçek fiziğe göre farklı kütle, top sayısı, yelken alanı, yalpa ve dönüş davranışı gösterir.
* **7 hava durumu**: Fırtına, Kasırga, Açık & güneşli, Sisli, Gün batımı, Gece fırtınası, Yağmurlu (+ kendiliğinden değişen hava). Dalga boyu/keskinliği, rüzgâr, gökyüzü, ışık, sis, yağmur, şimşek hepsi hava ile değişir; geçişler yumuşaktır.
* **Online çok oyunculu**: Bir oyuncu oda kurar (5 harfli kod / bağlantı), diğerleri katılır. Host simülasyonu çalıştırır, herkes kendi gemisini yönetir; eksik kalan gemileri yapay zekâ doldurur, oyuncular ayrılırsa gemi yapay zekâya devredilir, batınca yeniden doğabilirsin.
* **Mürettebat ve görev paylaşımı**: Gemilerde görünen denizciler (kılıçlı, tüfekçi) var; isabetler ve yangın mürettebatı azaltır, mürettebat azalınca toplar yavaş dolar. İki oyuncu aynı gemide **Dümenci** (dümen, yelken, abordaj) ve **Topçu** (nişan, ateş) olarak oynayabilir; boş görevi yapay zekâ yürütür.
* **Silahlar**: toplar, yakın mesafede tüfek yaylım ateşi, **abordaj** (F): halatlar iki gemiyi birbirine bağlar (fiziksel yay-sönümleyici), kılıç dövüşü mürettebatı eritir, kaybeden gemi ele geçirilir ve takım değiştirir.
* **Birinci şahıs karakterler**: Gemide yürürsün (W/A/S/D, fare ile bakış, Shift koş). Güverte, üst ve alt top güverteleri (kırmızı iç mekân, fenerler), ambar merdiveni, dümen. **Dümenci** yalnızca dümende durup gemiyi sürebilir ve toplara dokunamaz. **Topçu** ambara inip bir topun başına geçer ve topu **bakışıyla, göz kararı** doğrultup ateşler: nişangâh/menzil göstergesi yok, gemi yalpalarken namlu da yalpalar. Diğer oyuncuların karakterleri gemide yürürken görünür.
* **Silahlar ve gülle kamerası**: `1` tüfek (nişan bakışınla, 100 m'ye kadar, düşman güvertesindeki tayfayı vurur), `2` kılıç (abordajda düşman mürettebatını eritir), `3` eller boş. Silah elinde 1. şahıs görünür, başka oyuncular da senin silahını görür. Topu ateşleyince kamera güllenin peşine takılır ve nereye düştüğünü (isabet / ıskalama) gösterir; `Boşluk`/tık ile atlanır.
* **Oyuncu kontrolü (eski dış kamera)**: A/D dümen, W/S yelken, fare ile nişan (toplar yalnızca bordanı çeviren hedefe bakar), Boşluk / tık ile ateş. Minimap, rüzgâr oku, hız/rota, gövde ve top durumu.
* **Gerçek fizik**: yüzdürme, yelken kuvveti, dümen, balistik, yatma, su alma, batma, yangın, kırılan direkler ve tahtalar — hepsi simülasyondan çıkar, hazır animasyon yok.
* **Grafik (yeni)**: güneş gölge haritası (yelkenler güverteye ve denize gölge düşürür), denizde gemilerin düzlemsel yansıması, yağmur halkaları, yıldızlı gece + ay, güneş ışınları, hava başına renk ayarı, yelken/tahta kabartma dokusu, korkuluk/şalopa/çapa/aslan başlı pruva gibi gemi detayları, pruva ve batan gemi köpüğü, martılar, batan gemiden çıkan fıçı/tahta enkazı, çarpışma hasarı, otomatik kalite ölçekleme.
* **Grafik**: prosedürel gökyüzü, şimşek, analitik normalli okyanus (kırılma, köpük, gemi izi), namlu ışığının gemileri aydınlatması, gece fenerleri, HDR + bloom + FXAA, barut dumanı ve sıçramalar.

## Çalıştırma
```
python3 -m http.server 8000     # sonra http://localhost:8000
```
URL parametreleri: `?mode=solo|spectate`, `?weather=firtina|kasirga|acik|sisli|gunbatimi|gece|yagmur`, `?room=KOD`, `?seed=`, `?ships=`, `?hud=0`.

## Vercel'e yayınlama
Statik site: repo'yu Vercel'e "Import" et, Framework = *Other*, build komutu boş, çıktı dizini boş (kök). `vercel.json` hazırdır.

## Nasıl çalışıyor
### Tek dalga fonksiyonu (gemiler suyun içinden geçmez, havada durmaz)
`js/waves.js`: `h(x,z,t) = Σ Aᵢ (exp(sᵢ (sin(kᵢ·p − ωᵢt + φᵢ) − 1)) − mᵢ)` (derin su dispersiyonu ω² = g·k).
Aynı parametreler hem JS fiziğine (`Waves.height/sample`) hem GLSL'e (su, gemi, köpük) verilir. `__sim.waveTest(t)` GPU sonucunu JS ile kıyaslar (fark < 1 mm).

### Fizik (`js/physics.js`, `js/world.js`)
* 6 serbestlik dereceli rijit cisim; kütle/atalet her adımda nokta kütlelerden (gövde, safra, toplar, direkler, **su alan bölmeler**) yeniden hesaplanır.
* **Yüzdürme**: gövde ~120 prizmatik sütuna bölünür, her birinin batan hacmi dalga fonksiyonundan hesaplanır → yalpa, kabarma, metasantr yüksekliği doğal çıkar. Gemi sınıfları aynı gövde şeklinin ölçeklenmesidir (kütle s³, alan s²).
* **Yelken**: görünür rüzgâr polar diyagramı; yatınca yelkenler rüzgârı boşaltır. **Dümen** kıçta yan kuvvet üretir.
* **Top/gülle**: 16 kg demir küre, ~320 m/s + geminin hızı, sürtünme, yerçekimi; nişan için sürtünmeli balistik çözücü. Geri tepme gemiye darbe olur. Gövde/yelken/direk isabeti, sekme, delik açma.
* **Batma**: her delik Torricelli akışıyla bölmeleri doldurur; su kütlesi ağırlık merkezini ve ataleti değiştirir, serbest yüzey etkisi yatmayı artırır → gemi devrilir ya da batar.

### Ağ (`js/net.js`, `js/main.js`)
Host-otoriter model: istemci girdi (dümen/yelken/ateş/nişan) yollar, host 15 Hz anlık görüntü + olay akışı (atış, isabet, delik, batma) yayınlar; istemci 140 ms geriden interpolasyonla çizer. Delikler/direkler olaylarla, geç katılanlar tam durum paketiyle senkronlanır.
Not: Host sekmesi açık ve öndeyken en iyi çalışır. Katı NAT arkasında (TURN yok) bağlantı kurulamayabilir.

## Test araçları
`node tools/phys.mjs 120 1 3`, `node tools/classes.mjs` (gemi sınıfları), `tools/shot.mjs` (headless Chrome + CDP ile ekran görüntüsü, çoklu sekme ağ testi).
