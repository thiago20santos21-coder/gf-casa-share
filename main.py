import webview
import os
import sys

def main():
    # Detecta o caminho base de forma compatível
    if getattr(sys, 'frozen', False):
        base_dir = sys._MEIPASS
    else:
        base_dir = os.path.dirname(os.path.abspath(__file__))

    # Caminho absoluto para o seu index.html
    html_file = os.path.join(base_dir, 'index.html')

    # Cria a janela do aplicativo apontando para o seu HTML
    # Prefer hosted app (Auth/Firestore need https); fallback to local file
    app_url = os.environ.get('GF_APP_URL', 'https://gf-casa-share.web.app')
    janela = webview.create_window(
        title='GF Casa Share',
        url=app_url if app_url else f'file:///{html_file}',
        width=420,
        height=780,
        resizable=True,
        maximized=False
    )

    # Executa o aplicativo
    # O motor web vai renderizar usando WebView (Edge/Chromium no Windows, WebKit no Android)
    webview.start()

if __name__ == '__main__':
    main()
