from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import urllib.request
import urllib.error


HOST = "127.0.0.1"
PORT = 8000

CLAUDE_URL = "http://localhost:6655/anthropic/v1/messages"


class Handler(SimpleHTTPRequestHandler):

    def do_POST(self):

        if self.path != "/api/analyze":
            self.send_error(404)
            return

        try:
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)

            request_data = json.loads(body)

            api_key = request_data.get("apiKey")
            actions = request_data.get("actions")

            if not api_key:
                self.send_json(
                    {"error": "Claude API key is required."},
                    400
                )
                return

            if not isinstance(actions, list):
                self.send_json(
                    {"error": "Invalid actions data."},
                    400
                )
                return

            prompt = request_data.get("prompt")

            if not prompt:
                self.send_json(
                    {"error": "Analysis prompt is required."},
                    400
                )
                return

            claude_request = {
                "model": "anthropic--claude-haiku-latest",
                "max_tokens": 16384,
                "messages": [
                    {
                        "role": "user",
                        "content": prompt
                    }
                ]
            }

            claude_body = json.dumps(
                claude_request
            ).encode("utf-8")

            request = urllib.request.Request(
                CLAUDE_URL,
                data=claude_body,
                method="POST",
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}",
                    "anthropic-version": "2023-06-01"
                }
            )

            with urllib.request.urlopen(request) as response:
                response_body = response.read()

            self.send_json(
                json.loads(response_body.decode("utf-8")),
                200
            )

        except urllib.error.HTTPError as error:

            try:
                error_body = error.read().decode("utf-8")
                data = json.loads(error_body)
            except Exception:
                data = {
                    "error": str(error)
                }

            self.send_json(data, error.code)

        except Exception as error:

            self.send_json(
                {"error": str(error)},
                500
            )

    def send_json(self, data, status):

        response = json.dumps(data).encode("utf-8")

        self.send_response(status)
        self.send_header(
            "Content-Type",
            "application/json"
        )
        self.send_header(
            "Content-Length",
            str(len(response))
        )
        self.end_headers()

        self.wfile.write(response)


print(f"Starting Recurring Issue Analyzer on http://{HOST}:{PORT}")

server = ThreadingHTTPServer(
    (HOST, PORT),
    Handler
)

server.serve_forever()