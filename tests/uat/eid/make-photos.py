"""Stand-in photos for the walkthrough: a plainly fake licence card and a drawn face. Nothing real."""
import sys
from PIL import Image, ImageDraw
out = sys.argv[1]
card = Image.new('RGB', (640, 400), (232, 238, 246)); d = ImageDraw.Draw(card)
d.rectangle([0, 0, 640, 60], fill=(60, 90, 140)); d.text((20, 20), 'SAMPLE DRIVER LICENCE - NOT A REAL DOCUMENT', fill='white')
d.rectangle([24, 90, 204, 330], fill=(200, 205, 215)); d.ellipse([74, 120, 154, 200], fill=(150, 120, 100)); d.rectangle([64, 210, 164, 320], fill=(90, 100, 130))
for i, line in enumerate(['NAME  SINGH, RAJ KUMAR', 'DOB   1980-04-12', 'EXP   2030-06-30', 'CLASS G', 'TEST IMAGE FOR PII WALKTHROUGH']):
    d.text((230, 110 + i * 36), line, fill=(30, 30, 30))
card.save(f'{out}/licence.png')
face = Image.new('RGB', (360, 440), (210, 225, 235)); d = ImageDraw.Draw(face)
d.ellipse([90, 60, 270, 260], fill=(150, 120, 100)); d.ellipse([140, 130, 160, 150], fill='black'); d.ellipse([200, 130, 220, 150], fill='black')
d.arc([140, 170, 220, 220], 20, 160, fill='black', width=4); d.rectangle([70, 280, 290, 440], fill=(90, 100, 130))
face.save(f'{out}/selfie.png')
