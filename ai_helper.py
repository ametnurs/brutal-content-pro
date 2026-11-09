import base64
import json
import requests

BUILTIN_HOOK_TEMPLATES = [
    "Jangan beli ini sebelum tahu rahasia ini!",
    "Pantesan viral banget di TikTok, ternyata...",
    "Nyesel banget baru nemu sekarang!",
    "Review jujur setelah pakai 2 minggu...",
    "Stop buang uang buat produk mahal, coba ini!",
    "Bongkar alasan kenapa produk ini laku keras!",
    "Ini yang bikin orang pada kalap borong!",
    "Spill racun TikTok yang beneran worth it!",
    "Barang kecil tapi manfaatnya luar biasa!",
    "Beneran sebagus itu atau cuma gimmick?",
    "Cuma modal segini hasilnya sepuas ini!",
    "Gak heran ratingnya bintang 4.9 di keranjang kuning!",
    "Wajib punya ini kalau gamau ribet tiap hari!",
    "Definisi harga kaki lima kualitas bintang lima!",
    "Trik rahasia yang jarang dibongkar affiliate lain!",
    "Kaget pas checkout harganya lagi diskon gila-gilaan!",
    "Penyelamat hidup banget, recommended parah!",
    "Ini dia alasan keranjang kuningnya sering sold out!",
    "Buat yang sering nanya di komentar, ini linknya!",
    "Beli satu gak bakal nyesel, auto repeat order!"
]

def generate_hooks_gemini(api_key, product_name, selling_point, count=10):
    """
    Meminta Google AI Studio (Gemini 1.5 Flash) menghasilkan kalimat hook TikTok Affiliate
    yang singkat, menarik, dan berdaya jual tinggi (maksimal 7-10 kata per hook).
    """
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={api_key}"
    
    prompt = f"""
    Kamu adalah pakar copywriting TikTok Affiliate spesialis konten viral FYP ("brutal content").
    Tugasmu adalah membuat persis {count} kalimat hook pembuka (detik 0-3) yang sangat memancing rasa penasaran, FOMO, atau masalah pembeli.

    Informasi Produk:
    - Nama Produk: {product_name}
    - Keunggulan / Manfaat: {selling_point}

    Aturan:
    1. Tiap hook maksimal 6 - 9 kata (pendek, padat, nendang).
    2. Gunakan gaya bahasa Indonesia gaul/TikTok yang natural dan meyakinkan.
    3. Variasikan angle: rasa penasaran, rasa rugi/FOMO, review jujur, perbandingan harga, solusi masalah.
    4. Format jawaban HANYA berupa daftar baris kalimat hook, 1 baris untuk 1 hook, tanpa nomor urut, tanpa tanda kutip, tanpa kata pembuka atau penutup.
    """

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.85,
            "maxOutputTokens": 1000
        }
    }

    headers = {"Content-Type": "application/json"}
    response = requests.post(url, headers=headers, json=payload, timeout=20)
    if response.status_code != 200:
        error_msg = response.text
        try:
            err_json = response.json()
            error_msg = err_json.get("error", {}).get("message", response.text)
        except Exception:
            pass
        raise RuntimeError(f"Gagal memanggil Gemini API: {error_msg}")

    result_json = response.json()
    candidates = result_json.get("candidates", [])
    if not candidates:
        raise RuntimeError("Tidak ada jawaban dari Gemini API.")

    raw_text = candidates[0]["content"]["parts"][0]["text"].strip()
    lines = [line.strip().lstrip("- ").lstrip("1234567890. ") for line in raw_text.splitlines() if line.strip()]
    return lines[:count]

def generate_video_prompt_multimodal(
    api_key,
    product_img_bytes=None,
    product_mime="image/jpeg",
    talent_img_bytes=None,
    talent_mime="image/jpeg",
    product_name="",
    scene_style="Review Jujur & Rekomendasi",
    duration_sec=7
):
    """
    Menganalisis foto produk + foto talent menggunakan Gemini Multimodal,
    lalu meracik prompt skenario video sinematik yang siap dipakai di Google Gemini (Veo), Kling, atau CapCut AI.
    """
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={api_key}"

    instruction = f"""
    Kamu adalah sutradara video AI komersial spesialis iklan TikTok e-commerce & affiliate.
    Analisis foto produk dan foto talent yang diunggah.

    Informasi Tambahan:
    - Nama Produk: {product_name or 'Produk yang ada di gambar'}
    - Gaya Video / Scene: {scene_style}
    - Durasi Video yang Ditargetkan: Tepat {duration_sec} Detik ({duration_sec}.0s)

    Tugasmu adalah membuat instruksi prompt video AI yang sangat detail, spesifik, dan sinematik.
    Format output HARUS terstruktur rapi seperti berikut:

    [SCENE 1 — DURASI WAJIB: TEPAT {duration_sec} DETIK ({duration_sec}.0s) — EDIT MANUAL CAPCUT PRO — LOLOS DETEKSI AI — TANPA VO]
    • 🎬 DURASI WAJIB VIDEO: TEPAT {duration_sec} DETIK PENUH ({duration_sec}.0s / EXACT DURATION: {duration_sec} SECONDS).
    • 👤 MODEL / TALENT: (Deskripsikan talent dari gambar: penampilan, busana, ekspresi percaya diri & ramah).
    • 📦 PRODUK & INTERAKSI: (Deskripsikan bagaimana talent memegang, memperlihatkan, atau mendemonstrasikan produk dari gambar ke arah kamera).
    • 🎥 GERAKAN KAMERA (CAMERA MOTION): (Contoh: Smooth slow push-in, subtle orbital pan, shallow depth of field, 4k 60fps cinematic look).
    • 💡 LIGHTING & LATAR BELAKANG: (Pencahayaan soft studio aesthetic atau interior modern yang natural).
    • 🌍 ENGLISH MASTER PROMPT FOR AI GENERATOR (Untuk di-copy paste ke Gemini / Kling / Runway / Luma):
    (Tulis 1 paragraf prompt lengkap dalam Bahasa Inggris teknis untuk AI video generator).
    """

    parts = [{"text": instruction}]

    if product_img_bytes:
        parts.append({
            "inline_data": {
                "mime_type": product_mime,
                "data": base64.b64encode(product_img_bytes).decode("utf-8")
            }
        })
    if talent_img_bytes:
        parts.append({
            "inline_data": {
                "mime_type": talent_mime,
                "data": base64.b64encode(talent_img_bytes).decode("utf-8")
            }
        })

    payload = {
        "contents": [{"parts": parts}],
        "generationConfig": {
            "temperature": 0.75,
            "maxOutputTokens": 1500
        }
    }

    headers = {"Content-Type": "application/json"}
    response = requests.post(url, headers=headers, json=payload, timeout=30)
    if response.status_code != 200:
        error_msg = response.text
        try:
            err_json = response.json()
            error_msg = err_json.get("error", {}).get("message", response.text)
        except Exception:
            pass
        raise RuntimeError(f"Gagal memanggil Gemini API: {error_msg}")

    result_json = response.json()
    candidates = result_json.get("candidates", [])
    if not candidates:
        raise RuntimeError("Tidak ada jawaban dari Gemini API.")

    return candidates[0]["content"]["parts"][0]["text"].strip()
