// CloudFront Function (cloudfront-js-2.0). Only known HTML routes receive the shell.
function handler(event) {
  var request = event.request;
  if (request.method !== "GET" && request.method !== "HEAD")
    return { statusCode: 405, statusDescription: "Method Not Allowed" };
  var uri;
  try {
    uri = decodeURIComponent(request.uri);
  } catch (_) {
    return { statusCode: 400, statusDescription: "Bad Request" };
  }
  if (
    uri.indexOf("..") !== -1 ||
    uri.indexOf("\\") !== -1 ||
    uri.indexOf("\u0000") !== -1
  )
    return { statusCode: 400, statusDescription: "Bad Request" };
  var navigation =
    /^\/(?:$|start\/?$|locations\/?$|settings(?:\/[^.]*)?$|help\/?$|membership\/?$|warnings\/?$|(?:air|place|notifications)\/[^/]+\/?$|weather\/[^/]+\/(?:hourly|daily|overview)\/?$|nation\/(?:weather|air)\/?$)/.test(
      uri,
    );
  if (navigation) request.uri = "/index.html";
  else if (
    !/^\/(?:assets\/[^/]+|icons\/[^/]+|index\.html|sw\.js|manifest\.webmanifest|icon\.svg|release\.json)$/.test(
      uri,
    )
  )
    return { statusCode: 404, statusDescription: "Not Found" };
  return request;
}
