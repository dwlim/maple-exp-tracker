const fs=require('node:fs'),source=fs.readFileSync('hud-regions.js','utf8');
let html=fs.readFileSync('index.html','utf8').replace(/<!-- HUD REGIONS START -->[\s\S]*?<!-- HUD REGIONS END -->\s*/,'');
html=html.replace('</head>','<!-- HUD REGIONS START -->\n<script>'+source+'</script>\n<!-- HUD REGIONS END -->\n</head>');
fs.writeFileSync('index.html',html);
