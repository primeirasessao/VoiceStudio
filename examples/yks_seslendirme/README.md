# YKS sorusu seslendirme (Türkçe)

Bir sınav sorusunu ve çözümünü VoiceStudio ile sese çevirme örneği.
[`golge_sorusu.txt`](golge_sorusu.txt), benzer üçgenlerle gölge boyu sorusunun
seslendirmeye hazırlanmış metnidir.

## 1. Metni seslendirmeye hazırlayın

TTS motorları yazıyı olduğu gibi okur; LaTeX, ondalık sayılar ve Roma
rakamları bozuk okunur. Metni okunacağı gibi yazın:

| Kaynak | Seslendirme metni |
| --- | --- |
| `$\dfrac{1{,}5}{2}=0{,}75$` | bir virgül beş bölü iki, yani sıfır virgül yetmiş beş |
| `$8\cdot 0{,}75=6$` | sekiz çarpı sıfır virgül yetmiş beş, yani altı |
| `$6-3=3$` | altı eksi üç, yani üç |
| `1,5 m` | bir virgül beş metre |
| `I.`, `II.`, `III.` | Birinci ifade, İkinci ifade, Üçüncü ifade |
| `Doğru cevap: A.` | Doğru cevap: A. ("A şıkkı" hızlı okunuşta "aşkı" gibi duyuluyor) |

Tam sayılar (`16 m`) Türkçe için otomatik sözcüğe çevrilir, ama virgüllü
ondalıklar (`1,5`) rakam olarak kalır; bunları her zaman yazıyla verin.
Paragraf ve nokta kullanın: uzun metin cümle sınırlarından bölünür.

## 2. Bir Türkçe ses seçin

- **VoiceStudio (OmniVoice, varsayılan):** Türkçeyi destekler ve birkaç saniyelik
  bir referans kayıtla kendi sesinizi klonlayabilir. GPU önerilir.
- **Sherpa-ONNX + Piper `tr_TR-dfki-medium`:** CPU'da gerçek zamandan hızlı,
  klonlama yok. Kurulum: [docs/engines/sherpa-onnx.md](../../docs/engines/sherpa-onnx.md).

**Lisans:** Uygulama (AGPL-3.0) ticari kullanılabilir, ama sesi üreten modelin
kendi şartları geçerlidir. OmniVoice ağırlıkları CC-BY-NC, `tr_TR-dfki-medium`
verisi CC BY-NC-SA 4.0: ikisi de ticari olmayan kullanım içindir. Ticari bir iş
için modelin lisansını kendiniz kontrol edin; ayrıntılar
[docs/engines/sherpa-onnx.md](../../docs/engines/sherpa-onnx.md#licences) ve
[LICENSE-NOTICE.md](../../LICENSE-NOTICE.md).

## 3. Seslendirin

Uygulamada: **Ses** (Voice) ekranı → dili *Türkçe* seçin → metni yapıştırın → **Oluştur**.

API ile (backend açıkken, varsayılan port `3900`):

```bash
curl -X POST http://127.0.0.1:3900/generate \
  -F "text=<examples/yks_seslendirme/golge_sorusu.txt" \
  -F language=Turkish \
  -F engine=sherpa-onnx \
  -F speed=0.95 \
  -o golge_sorusu.wav
```

Kendi sesinizle okutmak için `engine=omnivoice` kullanın ve
`-F ref_audio=@ses_ornegim.wav -F "ref_text=<kayıttaki cümle>"` ekleyin. Model
ilk kullanımda lisans onayı isterse uygulamadaki **Model Catalogue** ekranından
onaylayın.

Üretilen kayıt, Whisper ile geri yazıya çevrilerek doğrulandı: metin
neredeyse birebir geri çıktı.
