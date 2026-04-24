## Version bumps

When `cod-form.js` changes, do both:

1. Update the `COD_FORM_VERSION` constant at the top of the file.
2. Bump `?v=N` on every embedded `<script src>` tag on the LPs:
   <script src="https://wenoka19.github.io/cod-system/cod-form.js?v=4"></script>

Semver: major for breaking config contract changes, minor for 
new features, patch for fixes. 
Check version from browser console: the script logs 
[cod-form] version 1.x.y on load.
