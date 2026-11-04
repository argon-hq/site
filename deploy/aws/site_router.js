// CloudFront Function (cloudfront-js-2.0), viewer request, on each environment's site distribution
// (site_cdn.tf). __CANONICAL_HOST__ is replaced by the environment's main hostname.
//
// 1. Any other name of the distribution (www) answers 308 to the same path on the canonical host,
//    query string included.
// 2. A file (a path whose last segment has a dot, or anything under /_next/) is served as it is,
//    except the navigation payloads (index.txt, __next.*.txt), which live in each locale folder.
// 3. A page is served from its locale folder: the `locale` cookie the locale switcher writes, or
//    pt-BR. The URL in the browser never changes, so the links in e-mails already sent still work.
// 4. A page path maps to its index.html (the export uses trailingSlash).

var CANONICAL = "__CANONICAL_HOST__";
var LOCALES = ["pt-BR", "en-US"];
var DEFAULT_LOCALE = "pt-BR";

function queryString(querystring) {
  var parts = [];
  for (var key in querystring) {
    var entry = querystring[key];
    var values = entry.multiValue ? entry.multiValue : [entry];
    for (var i = 0; i < values.length; i++) {
      parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(values[i].value));
    }
  }
  return parts.length ? "?" + parts.join("&") : "";
}

function handler(event) {
  var request = event.request;
  var host = request.headers.host ? request.headers.host.value.toLowerCase() : CANONICAL;

  if (host !== CANONICAL) {
    return {
      statusCode: 308,
      statusDescription: "Permanent Redirect",
      headers: { location: { value: "https://" + CANONICAL + request.uri + queryString(request.querystring) } },
    };
  }

  var uri = request.uri;
  if (uri.indexOf("/_next/") === 0) return request;

  var last = uri.substring(uri.lastIndexOf("/") + 1);
  // The payloads client-side navigation fetches live next to each page's index.html, in its locale
  // folder; every other file (robots.txt, icons, brand/, email/) is shared by both locales.
  var payload = last === "index.txt" || last.indexOf("__next.") === 0;
  var file = last.indexOf(".") !== -1;
  if (file && !payload) return request;

  var prefixed = false;
  for (var i = 0; i < LOCALES.length; i++) {
    if (uri === "/" + LOCALES[i] || uri.indexOf("/" + LOCALES[i] + "/") === 0) prefixed = true;
  }
  if (!prefixed) {
    var cookie = request.cookies.locale ? request.cookies.locale.value : "";
    var locale = LOCALES.indexOf(cookie) !== -1 ? cookie : DEFAULT_LOCALE;
    uri = "/" + locale + uri;
  }

  // A payload, or the Open Graph image the metadata names with its locale already, is a file.
  if (payload || last === "opengraph-image") {
    request.uri = uri;
    return request;
  }
  request.uri = uri.charAt(uri.length - 1) === "/" ? uri + "index.html" : uri + "/index.html";
  return request;
}
