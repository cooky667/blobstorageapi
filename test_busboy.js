const Busboy = require('busboy');
const fs = require('fs');
const path = require('path');
const http = require('http');

// Simple test server
const server = http.createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Send a POST with multipart/form-data to test');
    return;
  }

  console.log('--- Received POST ---');
  const bb = new Busboy({ headers: req.headers });

  bb.on('file', (fieldname, file, info) => {
    console.log('File event received:');
    console.log('  fieldname:', fieldname);
    console.log('  info:', JSON.stringify(info, null, 2));
    console.log('  info.filename:', info.filename);
    console.log('  info.encoding:', info.encoding);
    console.log('  info.mimeType:', info.mimeType);
    file.on('data', (data) => {
      console.log('  Data chunk:', data.length, 'bytes');
    });
    file.on('end', () => {
      console.log('  File stream ended');
    });
  });

  bb.on('error', (err) => {
    console.error('Busboy error:', err.message);
    res.writeHead(500);
    res.end('Error: ' + err.message);
  });

  bb.on('finish', () => {
    console.log('Busboy finish event');
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Upload received');
  });

  req.pipe(bb);
});

server.listen(9999, () => {
  console.log('Test server listening on http://localhost:9999');
  console.log('Test with: curl -F "file=@somefile.txt" http://localhost:9999');
});
