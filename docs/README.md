# docs/

`build-guide.js` generates `assets/NET-ETHER-Guide.docx` (the user guide the app opens as PDF).

Refresh it after a minor or major bump:

```
cd docs
node build-guide.js
soffice --headless --convert-to pdf NET-ETHER-Guide.docx
move /Y NET-ETHER-Guide.docx ..\assets\
move /Y NET-ETHER-Guide.pdf ..\assets\
```

Needs the `docx` npm package (`npm install docx` in `docs/` if `require('docx')` fails) and LibreOffice on PATH for the PDF step. Bump the "Application version" and "Document version" lines in the script first.
