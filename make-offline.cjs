const fs=require('node:fs');
const path=require('node:path');
let html=fs.readFileSync(path.join(__dirname,'public/index.html'),'utf8');
for(const name of ['data.js','cloud.js']) html=html.replace('<script src="'+name+'"></script>',()=>'<script>'+fs.readFileSync(path.join(__dirname,'public',name),'utf8')+'</script>');
fs.writeFileSync(path.join(__dirname,'오프라인-실행.html'),html);
console.log('Offline edition updated');
