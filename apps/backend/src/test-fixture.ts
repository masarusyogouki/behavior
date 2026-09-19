export const interactionFixtureHtml = String.raw`<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <title>Remote browser fixture</title>
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 2400px; font: 18px sans-serif; background: #fff; }
      button, input { position: absolute; left: 20px; width: 280px; height: 44px; font: inherit; }
      button { top: 20px; }
      input { top: 90px; }
      output { position: absolute; top: 150px; left: 20px; }
    </style>
  </head>
  <body>
    <button id="click-target" type="button">Click target</button>
    <form id="input-form"><input id="text-target" aria-label="Text target" /></form>
    <output id="result">ready</output>
    <script>
      let clicks = 0;
      document.querySelector('#click-target').addEventListener('click', () => {
        clicks += 1;
        document.querySelector('#result').textContent = 'clicked:' + clicks;
        location.hash = 'clicked-' + clicks;
      });
      document.querySelector('#input-form').addEventListener('submit', (event) => {
        event.preventDefault();
        const value = document.querySelector('#text-target').value;
        document.querySelector('#result').textContent = 'input:' + value;
        location.hash = 'input-' + encodeURIComponent(value);
      });
      let scrollQueued = false;
      addEventListener('scroll', () => {
        if (scrollQueued) return;
        scrollQueued = true;
        requestAnimationFrame(() => {
          scrollQueued = false;
          location.hash = 'scroll-' + Math.round(scrollY);
        });
      });
    </script>
  </body>
</html>`;
