const major=Number(process.versions.node.split('.')[0]);
if(major<24){console.error('ShopLink requires Node.js 24 or newer. Install it from https://nodejs.org/en/download');process.exit(1)}
console.log('Node.js '+process.version+' is ready.');
