import os
import sys
from pathlib import Path

# Fix Windows console UTF-8 output
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

from huggingface_hub import HfApi, login

def deploy():
    print("=" * 60)
    print("  🚀 DEPLOY KE HUGGING FACE SPACES (STREAMLIT)")
    print("=" * 60)

    token = os.environ.get("HF_TOKEN")
    if not token:
        if len(sys.argv) > 1:
            token = sys.argv[1].strip()
        else:
            token = input("\n🔑 Masukkan Hugging Face Write Token Anda:\n(Dapatkan gratis di https://huggingface.co/settings/tokens)\n> ").strip()

    if not token:
        print("❌ Error: Token Hugging Face wajib diisi!")
        return

    if len(sys.argv) > 2:
        space_name = sys.argv[2].strip()
    else:
        try:
            space_name = input("\n📦 Masukkan nama Space Anda (contoh: brutal-content-pro):\n> ").strip()
        except EOFError:
            space_name = "brutal-content-pro"
    if not space_name:
        space_name = "brutal-content-pro"

    try:
        api = HfApi(token=token)
        user_info = api.whoami()
        username = user_info["name"]
        repo_id = f"{username}/{space_name}"

        print(f"\n👤 Terkoneksi sebagai akun: @{username}")
        print(f"🛠️ Memeriksa / Membuat Space: {repo_id}...")

        api.create_repo(
            repo_id=repo_id,
            repo_type="space",
            space_sdk="streamlit",
            exist_ok=True,
            private=False
        )

        files_to_upload = [
            "app.py",
            "generator.py",
            "ai_helper.py",
            "license_manager.py",
            "requirements.txt",
            "packages.txt",
            "README.md"
        ]

        print("📤 Mengunggah file project ke Hugging Face Spaces...")
        for filename in files_to_upload:
            if os.path.exists(filename):
                print(f"   ⬆️ Uploading: {filename}")
                api.upload_file(
                    path_or_fileobj=filename,
                    path_in_repo=filename,
                    repo_id=repo_id,
                    repo_type="space"
                )

        space_url = f"https://huggingface.co/spaces/{repo_id}"
        app_url = f"https://{username}-{space_name.replace('_', '-')}.hf.space"

        print("\n" + "=" * 60)
        print("  🎉 DEPLOY BERHASIL KE HUGGING FACE SPACES!")
        print("=" * 60)
        print(f"🔗 Halaman Space Repository: {space_url}")
        print(f"📱 Link Web App / APK Live:   {app_url}")
        print("=" * 60)
        print("Tunggu sekitar 1 menit hingga status build menjadi 'Running', lalu buka di HP Anda!\n")

    except Exception as e:
        print(f"\n❌ Terjadi kesalahan saat deploy: {e}")

if __name__ == "__main__":
    deploy()
