# Piano Synth Studio — Geliştirme Tamamlandı 🎹

## 🌐 Sunucu Adresleri

| Ortam | URL |
|---|---|
| **Yerel (Mac)** | http://localhost:5173/ |
| **iPad / Diğer Cihazlar** | http://192.168.68.50:5173/ |

---

## ✅ Bu Sprintte Eklenen Özellikler

### 🎹 Bilgisayar Klavyesi ile Nota Çalma
- A S D F G H J K L ; tuşları → C3–E4 beyaz tuşlar
- W E T Y U O P → siyah tuşlar (diyezler)
- Z X C V B N M , → bir oktav yukarı (C4–C5)
- "Bilgisayar Klavyesi ile Çal" butonuna tıklayarak klavye haritasını görebilirsiniz

### 🔴 MIDI Kayıt (Recording) Modu
- "Kaydı Başlat" → piyano/klavye ile çal → "Kaydı Bitir & Kaydet"
- Çalınan notalar zaman damgalı şarkı olarak kütüphaneye eklenir

### 🔊 Master Volume + 🎚️ Tempo
- Header'da ses seviyesi slider (0% – 100%)
- Header'da tempo slider (0.50x – 2.00x)

### 🎵 6 Built-in Şarkı
1. Für Elise — Beethoven
2. Turkish March — Mozart
3. Moonlight Sonata — Beethoven
4. Ode to Joy — Beethoven
5. Canon in D — Pachelbel
6. Twinkle Twinkle — Geleneksel

### 🌊 Oscilloscope + 🎨 UI Yükseltmesi
- Visualizer'da SCOPE modu (canlı dalga formu)
- Animated background: neon parçacıklar + grid
- Per-pitch renk sistemi + parçacık patlama efektleri
- İstatistik paneli (basılan/doğru/doğruluk%)
- Clickable progress bar

### 🔧 Bug Düzeltmeleri
- soundEngine updateSynthType mantık hatası
- MIDI port dropdown (çok cihaz desteği)
- UPLOAD_DIR düzeltildi
- TypeScript: 0 hata ✅

---

## 🚀 Çalıştırma

```bash
cd /Users/eda/Desktop/piano-synth/frontend
npm run dev -- --host
```
