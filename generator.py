import os
import random
import subprocess
import textwrap
import zipfile
import asyncio
import concurrent.futures
from pathlib import Path
import edge_tts
import requests

import re

def get_video_metadata_ffmpeg(video_path):
    """
    Ambil informasi resolusi (lebar, tinggi) dan ada/tidaknya audio stream
    menggunakan ffmpeg -i langsung (tanpa ketergantungan pada ffprobe).
    """
    cmd = ["ffmpeg", "-i", str(video_path)]
    try:
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        combined = (res.stdout or "") + (res.stderr or "")
        
        # Cek Audio Stream
        has_audio = "Audio:" in combined
        
        # Cek Resolusi Video (misal 720x1280 atau 1080x1920)
        match_wh = re.search(r'Video:.*?, (\d{2,5})x(\d{2,5})', combined)
        if match_wh:
            w = int(match_wh.group(1))
            h = int(match_wh.group(2))
        else:
            w, h = 720, 1280
            
        return w, h, has_audio
    except Exception:
        return 720, 1280, True

def has_audio_stream(video_path):
    """Cek apakah video sumber memiliki track audio."""
    _, _, has_audio = get_video_metadata_ffmpeg(video_path)
    return has_audio

def get_video_info(video_path):
    """Ambil informasi lebar dan tinggi video."""
    w, h, _ = get_video_metadata_ffmpeg(video_path)
    return w, h

def extract_master_audio(video_path, output_audio_path):
    """
    Ekstrak master audio murni dari video sumber.
    Menjaga ekspresi, nafas, dan emosi natural asli dari talent/video.
    """
    cmd = [
        "ffmpeg", "-y",
        "-i", str(video_path),
        "-vn",
        "-c:a", "pcm_s16le",
        "-ar", "44100",
        "-ac", "2",
        str(output_audio_path)
    ]
    try:
        subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
        return Path(output_audio_path).exists()
    except Exception as e:
        print(f"Gagal ekstrak master audio: {e}")
        return False

def apply_audio_fingerprint_variation(input_audio, output_audio, semitones=0.0, speed=1.0, bass_boost=False):
    """
    Memodifikasi waveform audio mikro secara imperceptible (telinga tetap dengar natural):
    - Micro pitch shift
    - Micro atempo
    - Subtle EQ / Bass
    Tujuannya merombak sidik jari audio agar lolos deteksi duplikasi algoritma TikTok.
    """
    multiplier = round(2 ** (semitones / 12.0), 4)
    inv_mult = round(1.0 / multiplier, 4)
    
    af_filters = [f"asetrate=44100*{multiplier}", f"atempo={inv_mult}"]
    if speed != 1.0:
        af_filters.append(f"atempo={speed}")
    if bass_boost:
        af_filters.append("bass=g=1.5:f=120")
    
    af_str = ",".join(af_filters)
    cmd = [
        "ffmpeg", "-y",
        "-i", str(input_audio),
        "-af", af_str,
        str(output_audio)
    ]
    try:
        subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
        return output_audio
    except Exception:
        return input_audio

def wrap_hook_text(text, max_chars_per_line=24):
    """Bungkus teks agar rapi saat ditampilkan di video TikTok (maks 2-3 baris)."""
    clean_text = text.strip()
    lines = textwrap.wrap(clean_text, width=max_chars_per_line)
    return "\n".join(lines)

def generate_tts_audio(text, output_audio_path, voice="id-ID-GadisNeural", rate="+10%"):
    """
    Generate audio voiceover dari teks hook menggunakan edge-tts (Microsoft Natural Voice).
    Dijalankan di thread baru dengan event loop terisolasi agar aman di dalam Streamlit.
    """
    def _worker():
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            communicate = edge_tts.Communicate(text, voice, rate=rate)
            loop.run_until_complete(communicate.save(str(output_audio_path)))
            return True
        finally:
            loop.close()

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(_worker)
            return future.result(timeout=15)
    except Exception as e:
        print(f"Peringatan TTS: Gagal membuat VO untuk '{text}': {e}")
        return False

def generate_elevenlabs_clone(text, sample_audio_path, output_audio_path, api_key):
    """
    Melakukan Instant Voice Cloning menggunakan ElevenLabs API.
    """
    try:
        url_add = "https://api.elevenlabs.io/v1/voices/add"
        headers_add = {"xi-api-key": api_key}
        with open(sample_audio_path, "rb") as f:
            files = {"files": ("sample.wav", f, "audio/wav")}
            data = {"name": "User_Clone_Voice", "description": "Custom TikTok Affiliate Voice"}
            r_add = requests.post(url_add, headers=headers_add, data=data, files=files, timeout=30)
        
        voice_id = None
        if r_add.status_code == 200:
            voice_id = r_add.json().get("voice_id")
        else:
            r_get = requests.get("https://api.elevenlabs.io/v1/voices", headers=headers_add, timeout=15)
            if r_get.status_code == 200 and r_get.json().get("voices"):
                voice_id = r_get.json()["voices"][0]["voice_id"]

        if not voice_id:
            return False

        url_tts = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
        headers_tts = {"xi-api-key": api_key, "Content-Type": "application/json"}
        payload = {
            "text": text,
            "model_id": "eleven_multilingual_v2",
            "voice_settings": {"stability": 0.45, "similarity_boost": 0.85}
        }
        r_tts = requests.post(url_tts, headers=headers_tts, json=payload, timeout=30)
        if r_tts.status_code == 200:
            with open(output_audio_path, "wb") as f:
                f.write(r_tts.content)
            return True
        return False
    except Exception as e:
        print(f"Error ElevenLabs: {e}")
        return False

def apply_audio_pitch_shift(input_audio, output_audio, pitch_semitones=0):
    """
    Mengubah nada (pitch) audio tanpa mengubah tempo kecepatan bicara.
    pitch_semitones: -3 (bass/berat) s/d +3 (ceria/tinggi).
    """
    if pitch_semitones == 0:
        return input_audio

    multiplier = round(2 ** (pitch_semitones / 12.0), 4)
    inv_mult = round(1.0 / multiplier, 4)
    af_pitch = f"asetrate=44100*{multiplier},atempo={inv_mult}"
    
    cmd = [
        "ffmpeg", "-y",
        "-i", str(input_audio),
        "-af", af_pitch,
        str(output_audio)
    ]
    try:
        subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
        return output_audio
    except Exception:
        return input_audio

def generate_video_variations(
    input_video_path,
    hooks_list,
    output_dir,
    enable_zoom=True,
    enable_flip=False,
    enable_color_jitter=True,
    enable_speed_jitter=True,
    enable_capcut_fx=True,
    enable_white_flash=True,
    enable_vignette=True,
    enable_film_grain=True,
    dynamic_box_theme="auto",
    enable_vo=True,
    vo_type="video_audio_natural", # "video_audio_natural", "edge_tts", "user_recording_direct", "elevenlabs"
    vo_voice="id-ID-GadisNeural",
    vo_speed="+10%",
    vo_pitch_shift=0,
    user_audio_sample_path=None,
    elevenlabs_api_key=None,
    hook_duration=4,
    box_color="black@0.75",
    text_color="white",
    progress_callback=None
):
    """
    Me-render variasi video masif dengan kombinasi cerdas:
    1. MASTER AUDIO VIDEO ASLI: Mengekstrak suara asli video agar ekspresi & intonasi tetap natural,
       lalu memberi mikro-pitch/tempo acak per video agar lolos sensor duplikasi audio TikTok.
    2. CAPCUT EFEK VISUAL:
       - White Flash Opening saat hook dimulai (0.15 detik)
       - CapCut Color Moods (Vibrant TikTok, Warm Golden, Cool Modern, Cinematic Contrast)
       - Subtle Vignette & Micro Film Grain (Pixel-hash 100% unik)
       - Dynamic Hook Box Theme (berganti style otomatis tiap video)
    3. VOICEOVER ALTERNATIF: Edge TTS, Rekaman Mic User, atau ElevenLabs.
    """
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    in_w, in_h = get_video_info(input_video_path)
    in_w = in_w - (in_w % 2)
    in_h = in_h - (in_h % 2)
    has_orig_audio = has_audio_stream(input_video_path)

    # 1. Ekstrak Master Audio jika memilih mode "video_audio_natural"
    master_audio_extracted = None
    if vo_type == "video_audio_natural" and has_orig_audio:
        master_audio_extracted = output_dir / "master_audio_source.wav"
        extract_success = extract_master_audio(input_video_path, master_audio_extracted)
        if not extract_success or not master_audio_extracted.exists():
            master_audio_extracted = None

    # Definisi CapCut Color Moods Presets
    capcut_color_presets = [
        "eq=contrast=1.06:brightness=0.01:saturation=1.14",  # Preset 0: Vibrant TikTok Pop
        "colorbalance=rs=0.06:gs=0.02:bs=-0.06:rm=0.04:gm=0.01:bm=-0.04,eq=saturation=1.06",  # Preset 1: Warm Golden Hour
        "colorbalance=rs=-0.05:gs=0.01:bs=0.07:rm=-0.03:gm=0.02:bm=0.06,eq=saturation=1.04",   # Preset 2: Cool Minimalist
        "eq=contrast=1.09:brightness=-0.02:saturation=1.05"  # Preset 3: Cinematic Moody Contrast
    ]

    # Definisi Dynamic Hook Box Themes
    dynamic_box_styles = [
        ("yellow@0.92", "black"),   # TikTok Shop Yellow Box
        ("black@0.78", "white"),    # CapCut Dark Glass
        ("red@0.85", "white"),      # Flash Sale Red Alert
        ("blue@0.82", "white")      # Electric Blue
    ]

    generated_videos = []
    total = len(hooks_list)

    for idx, raw_hook in enumerate(hooks_list):
        hook_text = wrap_hook_text(raw_hook)
        out_name = f"video_{idx+1:03d}.mp4"
        out_path = output_dir / out_name
        
        # 1. Simpan teks hook ke file temporary untuk drawtext
        hook_txt_file = output_dir / f"temp_hook_{idx+1}.txt"
        with open(hook_txt_file, "w", encoding="utf-8") as f:
            f.write(hook_text)

        # 2. Persiapan Audio Voiceover / Master Audio Variasi
        vo_audio_file = output_dir / f"temp_vo_{idx+1}.wav"
        vo_shifted_file = output_dir / f"temp_vo_shifted_{idx+1}.wav"
        vo_success = False

        if enable_vo:
            if vo_type == "video_audio_natural" and master_audio_extracted and master_audio_extracted.exists():
                # Suara diambil dari video asli (ekspresi 100% natural), lalu diberi variasi mikro sidik jari audio
                rand_semitone = round(random.uniform(-0.45, 0.45), 2)
                rand_speed = round(random.uniform(0.985, 1.015), 3)
                use_bass = (idx % 2 == 1)
                apply_audio_fingerprint_variation(
                    master_audio_extracted,
                    vo_audio_file,
                    semitones=rand_semitone,
                    speed=rand_speed,
                    bass_boost=use_bass
                )
                if vo_audio_file.exists():
                    vo_success = True
            elif vo_type == "user_recording_direct" and user_audio_sample_path and Path(user_audio_sample_path).exists():
                # Pakai rekaman suara asli user langsung
                vo_audio_file = Path(user_audio_sample_path)
                vo_success = True
            elif vo_type == "elevenlabs" and elevenlabs_api_key and user_audio_sample_path:
                # Pakai Voice Cloning ElevenLabs
                vo_success = generate_elevenlabs_clone(raw_hook, user_audio_sample_path, vo_audio_file, elevenlabs_api_key)
            else:
                # Default: Edge TTS bahasa Indonesia
                vo_success = generate_tts_audio(raw_hook, vo_audio_file, voice=vo_voice, rate=vo_speed)

            # Terapkan Pitch Shifter manual jika user meminta penyesuaian nada eksplisit
            if vo_success and vo_type != "video_audio_natural" and vo_pitch_shift != 0:
                applied = apply_audio_pitch_shift(vo_audio_file, vo_shifted_file, pitch_semitones=vo_pitch_shift)
                if applied and Path(applied).exists():
                    vo_audio_file = applied

        # 3. Rakit Filter Visual (CapCut Effects + Anti-Duplicate)
        video_filters = []

        # (A) Efek White Flash Opening di Detik Awal Hook (khas CapCut)
        if enable_white_flash:
            video_filters.append("fade=t=in:st=0:d=0.15:color=white")

        # (B) Dynamic Zoom & Framing
        if enable_zoom:
            zoom = round(random.uniform(1.05, 1.15), 3)
            crop_w = int(in_w / zoom)
            crop_h = int(in_h / zoom)
            crop_w = crop_w - (crop_w % 2)
            crop_h = crop_h - (crop_h % 2)
            max_x = max(0, in_w - crop_w)
            max_y = max(0, in_h - crop_h)
            x_pos = random.randint(0, max_x)
            y_pos = random.randint(0, max_y)
            video_filters.append(f"crop={crop_w}:{crop_h}:{x_pos}:{y_pos},scale={in_w}:{in_h}")

        # (C) Horizontal Flip / Mirroring
        if enable_flip and random.choice([True, False]):
            video_filters.append("hflip")

        # (D) CapCut Color Moods atau Color Jitter Mikro
        if enable_capcut_fx:
            mood_filter = capcut_color_presets[idx % len(capcut_color_presets)]
            video_filters.append(mood_filter)
        elif enable_color_jitter:
            b = round(random.uniform(-0.03, 0.03), 3)
            c = round(random.uniform(0.97, 1.05), 3)
            s = round(random.uniform(0.95, 1.10), 3)
            video_filters.append(f"eq=brightness={b}:contrast={c}:saturation={s}")

        # (E) CapCut Soft Vignette
        if enable_vignette:
            video_filters.append("vignette=PI/6")

        # (F) CapCut Film Grain (Micro Noise Anti-Reupload)
        if enable_film_grain:
            video_filters.append("noise=alls=3:allf=t")

        # (G) Micro Speed Ramping
        speed_factor = 1.0
        if enable_speed_jitter:
            speed_factor = round(random.uniform(0.98, 1.02), 3)
            pts_factor = round(1.0 / speed_factor, 4)
            video_filters.append(f"setpts={pts_factor}*PTS")

        # (H) Penentuan Style Box Teks Hook
        if dynamic_box_theme == "auto":
            current_box_color, current_text_color = dynamic_box_styles[idx % len(dynamic_box_styles)]
        else:
            current_box_color = box_color
            current_text_color = text_color

        escaped_txt_path = str(hook_txt_file).replace("\\", "/").replace(":", "\\:")
        font_size = max(28, int(in_w * 0.055))
        drawtext_filter = (
            f"drawtext=textfile='{escaped_txt_path}':"
            f"fontcolor={current_text_color}:"
            f"fontsize={font_size}:"
            f"box=1:boxcolor={current_box_color}:boxborderw=14:"
            f"line_spacing=12:"
            f"x=(w-text_w)/2:y=(h-text_h)*0.22:"
            f"enable='between(t,0,{hook_duration})'"
        )
        video_filters.append(drawtext_filter)
        vf_str = ",".join(video_filters)

        # 4. Bangun Perintah FFmpeg dengan Audio Routing
        cmd = ["ffmpeg", "-y", "-i", str(input_video_path)]
        
        if vo_type == "video_audio_natural" and vo_success and Path(vo_audio_file).exists():
            # Menggunakan audio master video yang sudah dirombak sidik jarinya secara unik
            cmd.extend(["-i", str(vo_audio_file)])
            filter_complex = f"[0:v]{vf_str}[vout];[1:a]volume=1.0[aout]"
            cmd.extend([
                "-filter_complex", filter_complex,
                "-map", "[vout]",
                "-map", "[aout]"
            ])
        elif vo_success and Path(vo_audio_file).exists():
            # Menggunakan VO luar (TTS / Mic) di atas background audio video
            cmd.extend(["-i", str(vo_audio_file)])

            if has_orig_audio:
                speed_str = f",atempo={speed_factor}" if enable_speed_jitter else ""
                filter_complex = (
                    f"[0:v]{vf_str}[vout];"
                    f"[0:a]volume=0.35{speed_str}[bg];"
                    f"[1:a]volume=1.25[vo];"
                    f"[bg][vo]amix=inputs=2:duration=first:dropout_transition=2[aout]"
                )
                cmd.extend([
                    "-filter_complex", filter_complex,
                    "-map", "[vout]",
                    "-map", "[aout]"
                ])
            else:
                filter_complex = f"[0:v]{vf_str}[vout];[1:a]apad[aout]"
                cmd.extend([
                    "-filter_complex", filter_complex,
                    "-map", "[vout]",
                    "-map", "[aout]"
                ])
        else:
            # Tidak menggunakan VO baru, pakai audio bawaan video sumber jika ada
            cmd.extend(["-vf", vf_str])
            if has_orig_audio:
                if enable_speed_jitter:
                    cmd.extend(["-af", f"atempo={speed_factor}"])
                cmd.extend(["-map", "0:v", "-map", "0:a?"])
            else:
                cmd.extend(["-map", "0:v"])

        cmd.extend([
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", "22",
            "-c:a", "aac",
            "-b:a", "128k",
            "-map_metadata", "-1",
            str(out_path)
        ])

        try:
            subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
            generated_videos.append(out_path)
        except subprocess.CalledProcessError as e:
            print(f"Error rendering {out_name}: {e.stderr.decode('utf-8', errors='ignore')}")
        finally:
            if hook_txt_file.exists():
                try:
                    hook_txt_file.unlink()
                except Exception:
                    pass
            # Bersihkan file temp audio
            if vo_audio_file != user_audio_sample_path and Path(vo_audio_file).exists():
                try:
                    Path(vo_audio_file).unlink()
                except Exception:
                    pass
            if Path(vo_shifted_file).exists():
                try:
                    Path(vo_shifted_file).unlink()
                except Exception:
                    pass

        if progress_callback:
            progress_callback(idx + 1, total, out_name)

    # Bersihkan file master audio extraction jika ada
    if master_audio_extracted and Path(master_audio_extracted).exists():
        try:
            Path(master_audio_extracted).unlink()
        except Exception:
            pass

    return generated_videos

def create_zip_archive(video_paths, zip_output_path):
    """Gabungkan semua video ke dalam 1 file ZIP untuk kemudahan download pengguna HP."""
    zip_path = Path(zip_output_path)
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
        for v in video_paths:
            v = Path(v)
            if v.exists():
                zipf.write(v, arcname=v.name)
    return zip_path
