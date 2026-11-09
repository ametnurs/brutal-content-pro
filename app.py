import os
import shutil
import tempfile
import time
from pathlib import Path
import streamlit as st

from generator import generate_video_variations, create_zip_archive
from ai_helper import (
    BUILTIN_HOOK_TEMPLATES,
    generate_hooks_gemini,
    generate_video_prompt_multimodal
)
from license_manager import (
    get_or_create_hwid,
    activate_license_online,
    check_saved_license,
    revoke_local_license,
    BOT_USERNAME
)

# Folder Penyimpanan Suara Kustom
VOICES_DIR = Path("custom_voices")
VOICES_DIR.mkdir(parents=True, exist_ok=True)

# Ambil HWID Perangkat Ini
CURRENT_HWID = get_or_create_hwid()

# Konfigurasi Halaman (Mobile Native APK / Portrait Mode)
st.set_page_config(
    page_title="Brutal Content Creator",
    page_icon="⚡",
    layout="centered",
    initial_sidebar_state="collapsed"
)

# Custom CSS: Native Mobile App Look (Portrait Mode, Dark Glassmorphism, Thumb-Friendly)
st.markdown("""
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<meta name="theme-color" content="#0B0D13">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">

<style>
    #MainMenu, footer, header, .stDeployButton {
        display: none !important;
        visibility: hidden !important;
    }
    .stApp {
        background: #0A0C10;
        color: #F1F5F9;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    .main .block-container {
        max-width: 460px !important;
        padding-top: 0.8rem !important;
        padding-bottom: 5rem !important;
        padding-left: 14px !important;
        padding-right: 14px !important;
        margin: 0 auto;
    }
    .app-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: rgba(18, 22, 31, 0.85);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 18px;
        padding: 12px 16px;
        margin-bottom: 16px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    }
    .app-brand {
        display: flex;
        align-items: center;
        gap: 10px;
    }
    .brand-icon {
        width: 36px;
        height: 36px;
        background: linear-gradient(135deg, #FF0050 0%, #00F2FE 100%);
        border-radius: 10px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 20px;
        box-shadow: 0 4px 12px rgba(255, 0, 80, 0.4);
    }
    .brand-text h1 {
        font-size: 1.05rem !important;
        font-weight: 800 !important;
        margin: 0 !important;
        background: linear-gradient(90deg, #FFFFFF, #E2E8F0);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        letter-spacing: -0.3px;
    }
    .brand-text p {
        font-size: 0.72rem !important;
        color: #94A3B8 !important;
        margin: 0 !important;
    }
    .pro-badge {
        background: rgba(16, 185, 129, 0.15);
        color: #10B981;
        border: 1px solid rgba(16, 185, 129, 0.35);
        border-radius: 20px;
        padding: 3px 10px;
        font-size: 0.72rem;
        font-weight: 700;
        letter-spacing: 0.5px;
    }
    .lock-badge {
        background: rgba(239, 68, 68, 0.15);
        color: #EF4444;
        border: 1px solid rgba(239, 68, 68, 0.35);
        border-radius: 20px;
        padding: 3px 10px;
        font-size: 0.72rem;
        font-weight: 700;
    }
    .mobile-card {
        background: #12161F;
        border: 1px solid rgba(255, 255, 255, 0.07);
        border-radius: 16px;
        padding: 16px;
        margin-bottom: 14px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
    }
    .step-header {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 12px;
    }
    .step-pill {
        width: 26px;
        height: 26px;
        background: linear-gradient(135deg, #FF0050, #EE1D52);
        color: white;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.8rem;
        font-weight: 800;
    }
    .step-title {
        font-size: 0.95rem;
        font-weight: 700;
        color: #F8FAFC;
    }
    .hwid-badge {
        background: #080C14;
        border: 1px dashed rgba(0, 242, 254, 0.4);
        border-radius: 10px;
        padding: 10px 12px;
        font-family: monospace;
        font-size: 0.85rem;
        color: #00F2FE;
        letter-spacing: 0.5px;
        margin-bottom: 10px;
        text-align: center;
    }
    .stButton>button {
        width: 100% !important;
        border-radius: 14px !important;
        height: 50px !important;
        font-weight: 700 !important;
        font-size: 0.95rem !important;
        border: none !important;
        transition: transform 0.15s ease !important;
    }
    .stButton>button:active {
        transform: scale(0.97) !important;
    }
    .btn-generate button {
        background: linear-gradient(135deg, #FF0050 0%, #FE2C55 50%, #EE1D52 100%) !important;
        color: white !important;
        box-shadow: 0 6px 20px rgba(255, 0, 80, 0.45) !important;
    }
    .btn-download-zip button {
        background: linear-gradient(135deg, #00F2FE 0%, #4FACFE 100%) !important;
        color: #0A0C10 !important;
        font-weight: 800 !important;
        box-shadow: 0 6px 20px rgba(0, 242, 254, 0.35) !important;
    }
    .stTextInput input, .stTextArea textarea, .stSelectbox select {
        background: #181D27 !important;
        border: 1px solid rgba(255, 255, 255, 0.1) !important;
        border-radius: 12px !important;
        color: #F8FAFC !important;
    }
    .stTabs [data-baseweb="tab-list"] {
        background: #12161F;
        border-radius: 14px;
        padding: 4px;
        gap: 4px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        margin-bottom: 16px;
    }
    .stTabs [data-baseweb="tab"] {
        border-radius: 10px;
        color: #94A3B8;
        font-weight: 600;
        font-size: 0.85rem;
        flex: 1;
        justify-content: center;
        border: none !important;
    }
    .stTabs [aria-selected="true"] {
        background: #1E2430 !important;
        color: #FFFFFF !important;
        font-weight: 700;
    }
</style>
""", unsafe_allow_html=True)

# Inisialisasi Session State Lisensi
if "is_licensed" not in st.session_state:
    st.session_state["is_licensed"] = False
if "license_data" not in st.session_state:
    st.session_state["license_data"] = None

# Cek Lisensi Tersimpan Saat Startup
if not st.session_state["is_licensed"]:
    saved_ok, saved_info = check_saved_license(CURRENT_HWID)
    if saved_ok:
        st.session_state["is_licensed"] = True
        st.session_state["license_data"] = saved_info

# ==============================================================================
# JIKA LISENSI BELUM AKTIF -> TAMPILKAN LAYAR KUNCI AKTIVASI (ACTIVATION LOCK)
# ==============================================================================
if not st.session_state["is_licensed"]:
    # App Bar Versi Terkunci
    st.markdown("""
    <div class="app-bar">
        <div class="app-brand">
            <div class="brand-icon">🔒</div>
            <div class="brand-text">
                <h1>BRUTAL CONTENT</h1>
                <p>Aktivasi Lisensi HWID</p>
            </div>
        </div>
        <div class="lock-badge">TERKUNCI</div>
    </div>
    """, unsafe_allow_html=True)

    st.markdown(f"""
    <div class="mobile-card">
        <div class="step-header">
            <div class="step-pill">🔑</div>
            <div class="step-title">Aktivasi Lisensi Resmi</div>
        </div>
        <p style="font-size: 0.82rem; color: #94A3B8; line-height: 1.5; margin-bottom: 12px;">
            Aplikasi ini terikat dengan sistem keamanan <b>1 Device = 1 Lisensi</b>. Masukkan Kunci Lisensi Anda yang didapatkan dari Bot Telegram resmi.
        </p>
        <div class="hwid-badge">
            🖥️ HWID PERANGKAT:<br>
            <b style="font-size: 0.95rem; color: #FFFFFF;">{CURRENT_HWID}</b>
        </div>
        <p style="font-size: 0.75rem; color: #64748B; text-align: center; margin-bottom: 14px;">
            (Salin kode HWID di atas dan kirimkan ke Bot Telegram saat konfirmasi pembayaran)
        </p>
    """, unsafe_allow_html=True)

    input_license_key = st.text_input(
        "Kunci Lisensi (License Key):",
        placeholder="Contoh: BRUTAL-PRO-XXXX-XXXX",
        key="input_lic_field"
    )

    if st.button("🚀 AKTIFKAN APLIKASI SEKARANG", type="primary", use_container_width=True):
        if not input_license_key:
            st.warning("Silakan masukkan Kunci Lisensi terlebih dahulu!")
        else:
            with st.spinner("Memverifikasi lisensi ke Cloudflare Server..."):
                ok, msg = activate_license_online(CURRENT_HWID, input_license_key.strip())
                if ok:
                    st.success(f"🎉 {msg}")
                    st.session_state["is_licensed"] = True
                    st.session_state["license_data"] = {"hwid": CURRENT_HWID, "key": input_license_key.strip()}
                    time.sleep(1)
                    st.rerun()
                else:
                    st.error(f"❌ {msg}")

    st.write("---")
    st.markdown(f"""
    <div style="text-align: center; font-size: 0.82rem;">
        Belum punya lisensi resmi?<br>
        <a href="https://t.me/{BOT_USERNAME}?start=buy_brutal_pro_ref_direct" target="_blank" style="color: #00F2FE; font-weight: 700; text-decoration: none;">
            👉 Beli Lisensi via Bot Telegram (@{BOT_USERNAME})
        </a>
    </div>
    </div>
    """, unsafe_allow_html=True)

    st.stop()  # Hentikan eksekusi di sini jika belum teraktivasi!

# ==============================================================================
# JIKA LISENSI AKTIF -> BUKA SELURUH FITUR APLIKASI
# ==============================================================================

# App Bar Teraktivasi
st.markdown("""
<div class="app-bar">
    <div class="app-brand">
        <div class="brand-icon">⚡</div>
        <div class="brand-text">
            <h1>BRUTAL CONTENT</h1>
            <p>TikTok Affiliate Studio</p>
        </div>
    </div>
    <div class="pro-badge">✅ PRO AKTIF</div>
</div>
""", unsafe_allow_html=True)

# Inisialisasi Session State Konten
if "generated_results" not in st.session_state:
    st.session_state["generated_results"] = None
if "hooks_text" not in st.session_state:
    st.session_state["hooks_text"] = "\n".join(BUILTIN_HOOK_TEMPLATES[:5])
if "crafted_prompt" not in st.session_state:
    st.session_state["crafted_prompt"] = ""
if "user_custom_audio_path" not in st.session_state:
    st.session_state["user_custom_audio_path"] = None

# Sidebar: Pengaturan Algoritma Variasi & Lisensi
with st.sidebar:
    st.markdown("### 🛡️ Status Lisensi")
    st.success(f"Status: **PRO AKTIF**\n\nHWID: `{CURRENT_HWID}`")
    if st.button("Keluar / Ganti Lisensi"):
        revoke_local_license()
        st.session_state["is_licensed"] = False
        st.rerun()

    st.divider()
    st.markdown("### ⚙️ Algoritma Duplikasi TikTok")
    st.caption("Parameter ini mengacak sidik jari video agar lolos sensor re-upload:")
    
    enable_zoom = st.checkbox("🔍 Dynamic Zoom & Pan", value=True)
    enable_flip = st.checkbox("🔄 Mirroring (Flip Horizontal)", value=False)
    enable_color = st.checkbox("🎨 Color Grading Mikro", value=True)
    enable_speed = st.checkbox("⚡ Speed Ramping (0.98x - 1.02x)", value=True)
    
    st.divider()
    st.markdown("### 🎨 Desain Teks Hook")
    hook_duration = st.slider("Durasi Hook (detik)", min_value=2, max_value=6, value=4)
    box_color_choice = st.selectbox(
        "Warna Background Teks",
        ["Hitam Transparan", "Merah TikTok", "Kuning Kontras", "Biru"],
        index=0
    )
    box_color_map = {
        "Hitam Transparan": "black@0.75",
        "Merah TikTok": "red@0.85",
        "Kuning Kontras": "yellow@0.9",
        "Biru": "blue@0.8"
    }
    text_color_choice = "black" if "Kuning" in box_color_choice else "white"

# Tab Navigasi Utama (Mobile Segmented)
main_tab1, main_tab2 = st.tabs([
    "⚡ Mesin Brutal",
    "🎬 Studio AI (Talent)"
])

# ==============================================================================
# TAB 1: MESIN BRUTAL GENERATOR
# ==============================================================================
with main_tab1:
    # STEP 1: Upload Video
    st.markdown("""
    <div class="mobile-card">
        <div class="step-header">
            <div class="step-pill">1</div>
            <div class="step-title">Video Produk Utama</div>
        </div>
    """, unsafe_allow_html=True)
    
    video_to_process = None
    if "active_uploaded_video" in st.session_state and st.session_state["active_uploaded_video"]:
        st.info(f"Video dari Studio AI: **{st.session_state['active_uploaded_video'].name}**")
        video_to_process = st.session_state["active_uploaded_video"]

    manual_file = st.file_uploader(
        "Upload Video (MP4 / MOV):",
        type=["mp4", "mov"],
        key="manual_video_input",
        label_visibility="collapsed"
    )
    if manual_file:
        video_to_process = manual_file
        st.success(f"✅ Video siap: {manual_file.name}")
    st.markdown("</div>", unsafe_allow_html=True)

    # STEP 2: Voiceover & Suara
    st.markdown("""
    <div class="mobile-card">
        <div class="step-header">
            <div class="step-pill">2</div>
            <div class="step-title">Suara Narasi (Voiceover)</div>
        </div>
    """, unsafe_allow_html=True)
    
    enable_vo = st.checkbox("🎙️ Aktifkan Voiceover Pembaca Hook", value=True)
    
    vo_voice_choice = st.selectbox(
        "Pilihan Suara:",
        [
            "Gadis (Cewek TikTok Natural)",
            "Ardi (Cowok Percaya Diri)",
            "🎙️ Rekam Suara Saya Sendiri (Direct VO)",
            "🤖 AI Voice Cloning (ElevenLabs)"
        ],
        index=0,
        disabled=not enable_vo
    )

    user_audio_path = st.session_state["user_custom_audio_path"]
    elevenlabs_key = None
    vo_type_selected = "edge_tts"

    if enable_vo and ("Rekam Suara" in vo_voice_choice or "Voice Cloning" in vo_voice_choice):
        st.caption("Rekam suara lewat mic HP Anda (5–10 detik):")
        recorded_audio = st.audio_input("🔴 Tekan untuk Rekam Suara Langsung:")
        if recorded_audio:
            saved_rec_path = VOICES_DIR / "sample_user_mic.wav"
            with open(saved_rec_path, "wb") as f:
                f.write(recorded_audio.read())
            st.session_state["user_custom_audio_path"] = str(saved_rec_path)
            user_audio_path = str(saved_rec_path)
            st.success("✅ Rekaman tersimpan!")

        if user_audio_path and Path(user_audio_path).exists():
            st.audio(user_audio_path)

        if "Voice Cloning" in vo_voice_choice:
            vo_type_selected = "elevenlabs"
            elevenlabs_key = st.text_input("ElevenLabs API Key:", type="password")
        else:
            vo_type_selected = "user_recording_direct"
    else:
        vo_type_selected = "edge_tts"

    # Nada & Kecepatan Suara
    col_tune1, col_tune2 = st.columns(2)
    with col_tune1:
        vo_pitch_shift = st.slider(
            "Nada (Pitch):",
            min_value=-3, max_value=3, value=0,
            help="-3 = Berat/Bass | +3 = Ceria/Playful",
            disabled=not enable_vo
        )
    with col_tune2:
        vo_speed_choice = st.selectbox(
            "Kecepatan:",
            ["Cepat (+15%)", "Agak Cepat (+10%)", "Normal (+0%)"],
            index=1,
            disabled=not enable_vo
        )
        speed_map = {"Cepat (+15%)": "+15%", "Agak Cepat (+10%)": "+10%", "Normal (+0%)": "+0%"}
        vo_speed_val = speed_map[vo_speed_choice]
    
    st.markdown("</div>", unsafe_allow_html=True)

    # STEP 3: Kalimat Hook
    st.markdown("""
    <div class="mobile-card">
        <div class="step-header">
            <div class="step-pill">3</div>
            <div class="step-title">Daftar Hook (1 Baris = 1 Video)</div>
        </div>
    """, unsafe_allow_html=True)
    
    subtab_h1, subtab_h2 = st.tabs(["✍️ Manual", "✨ AI Hook"])
    with subtab_h1:
        hooks_input = st.text_area(
            "Hook Teks:",
            value=st.session_state["hooks_text"],
            height=130,
            label_visibility="collapsed"
        )
        st.session_state["hooks_text"] = hooks_input
        col_hb1, col_hb2 = st.columns(2)
        with col_hb1:
            if st.button("🔄 5 Hook Viral"):
                st.session_state["hooks_text"] = "\n".join(BUILTIN_HOOK_TEMPLATES[:5])
                st.rerun()
        with col_hb2:
            if st.button("🔥 10 Hook Viral"):
                st.session_state["hooks_text"] = "\n".join(BUILTIN_HOOK_TEMPLATES[:10])
                st.rerun()

    with subtab_h2:
        hook_gemini_key = st.text_input("Google AI Studio Key:", type="password", key="h_gem_key", placeholder="AIzaSy...")
        h_pname = st.text_input("Nama Produk:", placeholder="Contoh: Serum GlowUp", key="h_pname")
        h_pben = st.text_input("Keunggulan:", placeholder="Contoh: Cerah dalam 7 hari", key="h_pben")
        h_count = st.slider("Jumlah Hook:", 5, 20, 10, key="h_count")

        if st.button("✨ Buat Hook Otomatis"):
            if not hook_gemini_key or not h_pname:
                st.warning("Lengkapi API Key dan Nama Produk!")
            else:
                with st.spinner("AI meracik hook..."):
                    try:
                        g_list = generate_hooks_gemini(
                            api_key=hook_gemini_key.strip(),
                            product_name=h_pname,
                            selling_point=h_pben or "Kualitas terbaik",
                            count=h_count
                        )
                        st.session_state["hooks_text"] = "\n".join(g_list)
                        st.success(f"{len(g_list)} hook dibuat!")
                        st.rerun()
                    except Exception as e:
                        st.error(f"Gagal: {e}")

    st.markdown("</div>", unsafe_allow_html=True)

    # STEP 4: Tombol Generate Eksekusi
    hooks_lines = [line.strip() for line in st.session_state["hooks_text"].splitlines() if line.strip()]

    st.markdown('<div class="btn-generate">', unsafe_allow_html=True)
    start_generate = st.button(
        f"⚡ GENERATE {len(hooks_lines)} VIDEO BRUTAL SEKARANG",
        type="primary",
        use_container_width=True
    )
    st.markdown('</div>', unsafe_allow_html=True)

    if start_generate:
        if not video_to_process:
            st.error("⚠️ Upload video terlebih dahulu di Langkah 1!")
        elif len(hooks_lines) == 0:
            st.error("⚠️ Masukkan minimal 1 hook di Langkah 3!")
        else:
            temp_dir = tempfile.mkdtemp(prefix="brutal_apk_")
            temp_video_path = os.path.join(temp_dir, f"input_{video_to_process.name}")
            
            with open(temp_video_path, "wb") as f:
                f.write(video_to_process.getbuffer())

            render_output_dir = os.path.join(temp_dir, "outputs")
            os.makedirs(render_output_dir, exist_ok=True)

            progress_bar = st.progress(0)
            status_text = st.empty()

            def on_progress(done, total, filename):
                pct = done / total
                progress_bar.progress(pct)
                status_text.info(f"⏳ Render ({done}/{total}): **{filename}**...")

            vo_voice_id = "id-ID-GadisNeural" if "Gadis" in vo_voice_choice else "id-ID-ArdiNeural"

            start_time = time.time()
            try:
                results = generate_video_variations(
                    input_video_path=temp_video_path,
                    hooks_list=hooks_lines,
                    output_dir=render_output_dir,
                    enable_zoom=enable_zoom,
                    enable_flip=enable_flip,
                    enable_color_jitter=enable_color,
                    enable_speed_jitter=enable_speed,
                    enable_vo=enable_vo,
                    vo_type=vo_type_selected,
                    vo_voice=vo_voice_id,
                    vo_speed=vo_speed_val,
                    vo_pitch_shift=vo_pitch_shift,
                    user_audio_sample_path=user_audio_path,
                    elevenlabs_api_key=elevenlabs_key,
                    hook_duration=hook_duration,
                    box_color=box_color_map[box_color_choice],
                    text_color=text_color_choice,
                    progress_callback=on_progress
                )

                zip_file_path = os.path.join(temp_dir, "brutal_videos_bundle.zip")
                create_zip_archive(results, zip_file_path)

                elapsed = time.time() - start_time
                status_text.success(f"🎉 {len(results)} video selesai dalam {elapsed:.1f}s!")
                
                st.session_state["generated_results"] = {
                    "videos": [str(p) for p in results],
                    "zip": zip_file_path,
                    "hooks": hooks_lines
                }
            except Exception as e:
                st.error(f"Error render: {e}")

    # STEP 5: Hasil Download & Preview
    if st.session_state["generated_results"]:
        res_data = st.session_state["generated_results"]
        zip_path = res_data["zip"]
        video_list = res_data["videos"]
        hooks = res_data["hooks"]

        st.markdown("""
        <div class="mobile-card">
            <div class="step-header">
                <div class="step-pill">📦</div>
                <div class="step-title">Video Siap Upload TikTok</div>
            </div>
        """, unsafe_allow_html=True)

        if os.path.exists(zip_path):
            with open(zip_path, "rb") as zf:
                st.markdown('<div class="btn-download-zip">', unsafe_allow_html=True)
                st.download_button(
                    label=f"⬇️ DOWNLOAD SEMUA ({len(video_list)} VIDEO .ZIP)",
                    data=zf.read(),
                    file_name="brutal_tiktok_bundle.zip",
                    mime="application/zip",
                    use_container_width=True
                )
                st.markdown('</div>', unsafe_allow_html=True)

        st.write("")
        st.caption("Preview hasil video:")

        for idx, v_path in enumerate(video_list):
            st.markdown(f"**Video #{idx+1}** - *\"{hooks[idx] if idx < len(hooks) else ''}\"*")
            if os.path.exists(v_path):
                st.video(v_path)
                with open(v_path, "rb") as vf:
                    st.download_button(
                        label=f"Download Video #{idx+1}",
                        data=vf.read(),
                        file_name=f"video_{idx+1:03d}.mp4",
                        mime="video/mp4",
                        key=f"dl_apk_{idx}"
                    )
            st.write("---")
        st.markdown("</div>", unsafe_allow_html=True)


# ==============================================================================
# TAB 2: STUDIO AI (TALENT + PRODUK)
# ==============================================================================
with main_tab2:
    st.markdown("""
    <div class="mobile-card">
        <div class="step-header">
            <div class="step-pill">🎬</div>
            <div class="step-title">AI Video: Talent + Produk</div>
        </div>
        <p style="font-size: 0.8rem; color: #94A3B8; margin-bottom: 12px;">
            Upload foto produk dan model, Gemini akan meracik prompt sinematik untuk web Gemini / CapCut AI.
        </p>
    """, unsafe_allow_html=True)

    col_p1, col_p2 = st.columns(2)
    with col_p1:
        st.caption("1. Foto Produk")
        product_file = st.file_uploader("Foto Produk:", type=["jpg", "jpeg", "png"], key="apk_prod", label_visibility="collapsed")
        if product_file:
            st.image(product_file, use_container_width=True)
    with col_p2:
        st.caption("2. Foto Model")
        talent_file = st.file_uploader("Foto Model:", type=["jpg", "jpeg", "png"], key="apk_talent", label_visibility="collapsed")
        if talent_file:
            st.image(talent_file, use_container_width=True)

    product_title = st.text_input("Nama Produk:", placeholder="Contoh: Bola Voli / Serum GlowUp")
    scene_style = st.selectbox(
        "Gaya Skenario:",
        [
            "Review Jujur & Rekomendasi",
            "Aksi / Demonstrasi Pemakaian",
            "Unboxing Estetik & Detail",
            "Reaksi Kaget & Terpukau"
        ]
    )
    gemini_api_key = st.text_input("Google AI Studio API Key:", type="password", key="apk_gem_key", placeholder="AIzaSy...")
    duration_target = st.select_slider("Durasi Video (detik):", options=[5, 7, 10], value=7)

    if st.button("✨ Racik Super-Prompt AI", type="primary"):
        if not gemini_api_key or not product_file or not talent_file:
            st.warning("Lengkapi API Key, Foto Produk, dan Foto Model!")
        else:
            with st.spinner("Gemini merancang skenario..."):
                try:
                    crafted = generate_video_prompt_multimodal(
                        api_key=gemini_api_key.strip(),
                        product_img_bytes=product_file.getvalue(),
                        product_mime=product_file.type,
                        talent_img_bytes=talent_file.getvalue(),
                        talent_mime=talent_file.type,
                        product_name=product_title,
                        scene_style=scene_style,
                        duration_sec=duration_target
                    )
                    st.session_state["crafted_prompt"] = crafted
                    st.success("Prompt berhasil diracik!")
                except Exception as e:
                    st.error(f"Gagal: {e}")

    if st.session_state["crafted_prompt"]:
        st.text_area("Salin Prompt ini:", value=st.session_state["crafted_prompt"], height=160)
        st.markdown("[👉 **Buka Google Gemini Web (gemini.google.com)**](https://gemini.google.com)")

        st.write("---")
        st.caption("Download video dari Gemini lalu masukkan ke sini:")
        external_video = st.file_uploader("Upload Hasil Video MP4:", type=["mp4", "mov"], key="apk_ext_v")
        if external_video:
            st.success(f"Video siap: {external_video.name}")
            if st.button("🚀 Kirim ke Mesin Brutal ➔"):
                st.session_state["active_uploaded_video"] = external_video
                st.info("Video dikirim! Buka Tab '⚡ Mesin Brutal' di atas.")

    st.markdown("</div>", unsafe_allow_html=True)
