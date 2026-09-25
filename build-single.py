"""Inline style.css and script.js into one self-contained HTML file."""
from pathlib import Path
here = Path(__file__).parent
html = (here / 'index.html').read_text()
css = (here / 'style.css').read_text()
js = (here / 'script.js').read_text()
html = html.replace('<link rel="stylesheet" href="style.css">', f'<style>\n{css}\n</style>')
html = html.replace('<script src="script.js"></script>', f'<script>\n{js}\n</script>')
out = here / 'single-file' / 'nursiecare-cv-builder.html'
out.parent.mkdir(exist_ok=True)
out.write_text(html)
print('Wrote', out)
