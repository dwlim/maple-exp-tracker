const fs=require('node:fs'),source=fs.readFileSync('stream-card.js','utf8');
let html=fs.readFileSync('index.html','utf8').replace(/<!-- STREAM CARD START -->[\s\S]*?<!-- STREAM CARD END -->\s*/,'');
html=html.replace('</head>','<!-- STREAM CARD START -->\n<script>'+source+'</script>\n<!-- STREAM CARD END -->\n</head>');
fs.writeFileSync('index.html',html);
