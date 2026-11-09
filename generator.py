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

def has_audio_stream(video_path):
    """Cek apakah video sumber memiliki track audio."""
    cmd = [
        "ffprobe", "-v", "error",
        "-select_streams", "a:0",
        "-show_entries", "stream=codec_type",
        "-of", "default=nw=1:nk=1",
        str(video_path)
    ]
    try:
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
        return "audio" in res.stdout.strip().lower()
    except Exception:
        return False

def get_video_info(video_path):
    """Ambil informasi lebar dan tinggi video menggunakan ffprobe."""
    cmd = [
        "ffprobe", "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height",
        "-of", "csv=p=0:s=x",
        str(video_path)
    ]
    try:
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
        parts = res.stdout.strip().split("x")
        w = int(parts[0])
        h = int(parts[1])
        return w, h
    except Exception:
        return 720, 1280

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
        # 1. Add voice with sample
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
            # Jika limit voice penuh, ambil voice pertama
            r_get = requests.get("https://api.elevenlabs.io/v1/voices", headers=headers_add, timeout=15)
            if r_get.status_code == 200 and r_get.json().get("voices"):
                voice_id = r_get.json()["voices"][0]["voice_id"]

        if not voice_id:
            return False

        # 2. Text to speech
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
    # Filter asetrate + atempo
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
    enable_vo=True,
    vo_type="edge_tts",          # "edge_tts", "user_recording_direct", "elevenlabs"
    vo_voice="id-ID-GadisNeural",
    vo_speed="+10%",
    vo_pitch_shift=0,            # -3 s/d +3
    user_audio_sample_path=None,
    elevenlabs_api_key=None,
    hook_duration=4,
    box_color="black@0.75",
    text_color="white",
    progress_callback=None
):
    """
    Me-render variasi video dengan kombinasi:
    - Voiceover (VO) hook (Bisa Edge TTS, Rekaman User Langsung, atau ElevenLabs Voice Clone)
    - Custom Pitch Shift (Mengubah nada suara agar unik & personal)
    - Framing/Crop acak (zoom in 1.05x - 1.15x)
    - Mirroring acak
    - Color grading mikro
    - Micro speed ramping
    - Overlay teks hook di detik awal
    """
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    in_w, in_h = get_video_info(input_video_path)
    in_w = in_w - (in_w % 2)
    in_h = in_h - (in_h % 2)
    has_orig_audio = has_audio_stream(input_video_path)

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

        # 2. Persiapan Audio Voiceover
        vo_audio_file = output_dir / f"temp_vo_{idx+1}.mp3"
        vo_shifted_file = output_dir / f"temp_vo_shifted_{idx+1}.mp3"
        vo_success = False

        if enable_vo:
            if vo_type == "user_recording_direct" and user_audio_sample_path and Path(user_audio_sample_path).exists():
                # Pakai rekaman suara asli user langsung
                vo_audio_file = Path(user_audio_sample_path)
                vo_success = True
            elif vo_type == "elevenlabs" and elevenlabs_api_key and user_audio_sample_path:
                # Pakai Voice Cloning ElevenLabs
                vo_success = generate_elevenlabs_clone(raw_hook, user_audio_sample_path, vo_audio_file, elevenlabs_api_key)
            else:
                # Default: Edge TTS bahasa Indonesia
                vo_success = generate_tts_audio(raw_hook, vo_audio_file, voice=vo_voice, rate=vo_speed)

            # Terapkan Pitch Shifter jika ada penyesuaian nada
            if vo_success and vo_pitch_shift != 0:
                applied = apply_audio_pitch_shift(vo_audio_file, vo_shifted_file, pitch_semitones=vo_pitch_shift)
                if applied and Path(applied).exists():
                    vo_audio_file = applied

        # 3. Rakit Filter Video
        video_filters = []

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

        if enable_flip and random.choice([True, False]):
            video_filters.append("hflip")

        if enable_color_jitter:
            b = round(random.uniform(-0.03, 0.03), 3)
            c = round(random.uniform(0.97, 1.05), 3)
            s = round(random.uniform(0.95, 1.10), 3)
            video_filters.append(f"eq=brightness={b}:contrast={c}:saturation={s}")

        speed_factor = 1.0
        if enable_speed_jitter:
            speed_factor = round(random.uniform(0.98, 1.02), 3)
            pts_factor = round(1.0 / speed_factor, 4)
            video_filters.append(f"setpts={pts_factor}*PTS")

        escaped_txt_path = str(hook_txt_file).replace("\\", "/").replace(":", "\\:")
        font_size = max(28, int(in_w * 0.055))
        drawtext_filter = (
            f"drawtext=textfile='{escaped_txt_path}':"
            f"fontcolor={text_color}:"
            f"fontsize={font_size}:"
            f"box=1:boxcolor={box_color}:boxborderw=14:"
            f"line_spacing=12:"
            f"x=(w-text_w)/2:y=(h-text_h)*0.22:"
            f"enable='between(t,0,{hook_duration})'"
        )
        video_filters.append(drawtext_filter)
        vf_str = ",".join(video_filters)

        # 4. Bangun Perintah FFmpeg dengan Audio Mix
        cmd = ["ffmpeg", "-y", "-i", str(input_video_path)]
        
        if vo_success and Path(vo_audio_file).exists():
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
            # Bersihkan file temp audio (kecuali file original rekaman user)
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
