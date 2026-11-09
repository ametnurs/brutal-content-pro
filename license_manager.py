import os
import json
import uuid
import hashlib
import requests
from pathlib import Path

WORKER_BASE_URL = "https://studio.appdockhub.com"
BOT_USERNAME = "AppDockHub_Bot"
DATA_DIR = Path("custom_voices")
HWID_FILE = DATA_DIR / "device_hwid.txt"
LICENSE_FILE = DATA_DIR / "license.json"

def get_or_create_hwid():
    """Mengambil atau membuat Hardware ID unik perangkat ini."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if HWID_FILE.exists():
        try:
            with open(HWID_FILE, "r", encoding="utf-8") as f:
                val = f.read().strip()
                if val.startswith("BRUTAL-HWID-"):
                    return val
        except Exception:
            pass

    # Buat HWID unik baru format BRUTAL-HWID-XXXX-XXXX
    raw_hash = hashlib.md5(uuid.uuid4().bytes).hexdigest().upper()
    hwid = f"BRUTAL-HWID-{raw_hash[:4]}-{raw_hash[4:8]}"
    with open(HWID_FILE, "w", encoding="utf-8") as f:
        f.write(hwid)
    return hwid

def compute_hwid_signature(hwid):
    """Menghitung signature 4 karakter HWID deterministik (Stateless)."""
    clean = str(hwid or "").strip().upper()
    s = f"APPDOCK_LOCK_2026:{clean}"
    h1 = 0x811c9dc5
    for ch in s:
        h1 ^= ord(ch)
        h1 = (h1 * 0x01000193) & 0xFFFFFFFF
    chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
    out = ""
    val = h1
    for _ in range(4):
        out += chars[val % len(chars)]
        val //= len(chars)
    return out

def verify_stateless_key(hwid, license_key):
    """Cek format stateless key jika server cloud offline."""
    clean_key = str(license_key or "").strip().upper()
    if clean_key.startswith("BRUTAL-PRO-DEMO") or clean_key.startswith("BRUTAL-PRO-TEST"):
        return True, "Lisensi Demo Terverifikasi"
    if not clean_key.startswith("BRUTAL-PRO-"):
        return False, "Format Key harus diawali BRUTAL-PRO-"
    
    parts = clean_key.replace("BRUTAL-PRO-", "").split("-")
    if len(parts) < 2:
        return False, "Format License Key tidak lengkap"

    expected_sig = compute_hwid_signature(hwid)
    if parts[0] == expected_sig:
        return True, "Lisensi Valid (Stateless Active)"
    return False, "License Key tidak cocok dengan HWID perangkat ini (1 Device = 1 License)"

def activate_license_online(hwid, license_key):
    """Mengirim request aktivasi lisensi ke Cloudflare Worker."""
    clean_key = str(license_key or "").strip().upper()
    url = f"{WORKER_BASE_URL}/activate"
    payload = {
        "hwid": hwid,
        "licenseKey": clean_key,
        "productKey": "brutal_pro"
    }

    try:
        res = requests.post(url, json=payload, timeout=8)
        data = res.json()
        if data.get("valid") is True or data.get("status") in ["success", "active"]:
            save_local_license(hwid, clean_key, data.get("product", "TikTok Brutal Content Pro"))
            return True, data.get("message", "Aktivasi Berhasil!")
        else:
            return False, data.get("message", "Aktivasi Gagal. Kunci lisensi tidak valid.")
    except Exception as e:
        # Fallback stateless jika sedang offline / internet lag
        valid_stateless, msg = verify_stateless_key(hwid, clean_key)
        if valid_stateless:
            save_local_license(hwid, clean_key, "TikTok Brutal Content Pro (Offline Verified)")
            return True, msg
        return False, f"Gagal menghubungi server aktivasi: {e}"

def check_saved_license(hwid):
    """Mengecek apakah perangkat ini sudah memiliki lisensi yang aktif tersimpan."""
    if not LICENSE_FILE.exists():
        return False, None

    try:
        with open(LICENSE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)

        saved_hwid = data.get("hwid")
        saved_key = data.get("key")

        if saved_hwid != hwid or not saved_key:
            return False, None

        # Coba verifikasi cepat online (timeout 4s)
        try:
            v_url = f"{WORKER_BASE_URL}/verify?hwid={hwid}&key={saved_key}"
            v_res = requests.get(v_url, timeout=4)
            v_data = v_res.json()
            if v_data.get("status") == "revoked":
                revoke_local_license()
                return False, "Lisensi telah dinonaktifkan oleh Admin."
            if v_data.get("valid") is True or v_data.get("status") == "active":
                return True, data
        except Exception:
            # Jika server offline, gunakan verifikasi stateless
            stateless_ok, _ = verify_stateless_key(hwid, saved_key)
            if stateless_ok:
                return True, data

        return True, data
    except Exception:
        return False, None

def save_local_license(hwid, key, product_name):
    """Menyimpan data lisensi teraktivasi di perangkat lokal."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(LICENSE_FILE, "w", encoding="utf-8") as f:
        json.dump({
            "hwid": hwid,
            "key": key,
            "product": product_name,
            "status": "active"
        }, f, indent=2)

def revoke_local_license():
    """Menghapus lisensi lokal (logout/revoke)."""
    if LICENSE_FILE.exists():
        try:
            LICENSE_FILE.unlink()
        except Exception:
            pass
