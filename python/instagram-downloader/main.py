import yt_dlp
import tempfile
import uuid
import os
from flask import Flask, request, jsonify, send_file

app = Flask(__name__)


@app.route("/", methods=["GET"])
def health_check():
    return jsonify({"status": "healthy", "service": "Instagram Downloader"}), 200


@app.route("/download", methods=["POST"])
def download_instagram_video():
    """
    Webhook endpoint to download Instagram video and serve it directly to the user.
    """
    try:
        data = request.get_json()
        if not data or "url" not in data:
            return jsonify(
                {"error": "Please provide an Instagram 'url' in the JSON body."}
            ), 400

        instagram_url = data["url"]

        temp_dir = tempfile.mkdtemp()
        filename = f"{uuid.uuid4()}.mp4"
        output_path = os.path.join(temp_dir, filename)

        download_options = {
            "outtmpl": output_path,
            "format": "best[ext=mp4]/best",
            "noplaylist": True,
            "quiet": True,
            "no_warnings": True,
        }

        with yt_dlp.YoutubeDL(download_options) as ydl:
            ydl.download([instagram_url])

        if not os.path.exists(output_path):
            return jsonify({"error": "Video download failed - file not found."}), 500

        return send_file(
            output_path,
            as_attachment=True,
            download_name=filename,
            mimetype="video/mp4",
        )

    except yt_dlp.utils.DownloadError as e:
        return jsonify({"error": f"Failed to process URL: {str(e)}"}), 500
    except Exception as e:
        return jsonify({"error": f"An unexpected error occurred: {e}"}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080, debug=True)
