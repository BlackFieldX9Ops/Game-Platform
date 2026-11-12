package com.gameplatform.app;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.util.Base64;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import androidx.activity.OnBackPressedCallback;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;

/**
 * Tela cheia de ponta a ponta e controle de orientação para o Game Platform.
 *
 * O app web chama window.GPNative:
 *   setFullscreen(boolean)  esconde ou mostra as barras do sistema
 *   setBackLock(boolean)    trava o botão voltar do celular durante o jogo
 *   setOrientation("portrait" | "landscape" | "auto")  trava a tela em pé, deitada, ou deixa girar
 *   canInstall() / openInstallSettings() / installApk(url)  atualização automática do app
 *   installApkVerified(url, sha256, size)  baixa, confere o SHA-256 e só então instala
 *   getInstaller() / openStore()  detectam instalação pela Play Store e abrem a loja
 *   getBuild() / openUrl(url)  usados pela atualização do app
 *   takeAuth()                 código de login devolvido pelo Google (gameplatform://auth)
 *
 * Fora dos jogos o app fica em pé; ao abrir um jogo o app web pede a orientação do jogo.
 * Este arquivo substitui o MainActivity gerado pelo Capacitor (veja .github/workflows/build-apk.yml).
 */
public class MainActivity extends BridgeActivity {
  private OnBackPressedCallback backLock;
  private static final int BG = 0xFF0A0D1C;
  private static final String ACT_INSTALL = "com.gameplatform.app.INSTALL_DONE";
  private boolean fullscreen = true;
  private volatile boolean updating = false;

  /** Recebe o resultado da instalação do APK novo. */
  private final BroadcastReceiver installReceiver = new BroadcastReceiver() {
    @Override
    public void onReceive(Context c, Intent i) {
      int st = i.getIntExtra(PackageInstaller.EXTRA_STATUS, -1);
      if (st == PackageInstaller.STATUS_PENDING_USER_ACTION) {
        // O Android exige uma confirmação desta vez (ex.: Android 11 ou menos, ou primeira instalação).
        Intent ask = i.getParcelableExtra(Intent.EXTRA_INTENT);
        if (ask != null) {
          ask.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
          try { startActivity(ask); } catch (Exception ignored) { }
          js("inst-ask", "");
        }
      } else if (st == PackageInstaller.STATUS_SUCCESS) {
        updating = false;
      } else {
        updating = false;
        String m = i.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
        js("err", m == null ? "Falha ao instalar" : m);
      }
    }
  };

  // Volta do login com o Google: gameplatform://auth?code=...
  private String pendingAuth = null;

  private void readAuthIntent(Intent it) {
    if (it == null || it.getData() == null) return;
    Uri u = it.getData();
    if (!"gameplatform".equals(u.getScheme()) || !"auth".equals(u.getHost())) return;
    String c = u.getQueryParameter("code");
    if (c == null || !c.matches("[a-f0-9]{16,80}")) return;
    pendingAuth = c;
    it.setData(null);
    WebView w = getBridge() != null ? getBridge().getWebView() : null;
    if (w != null) w.post(() -> w.evaluateJavascript("window.GPAuth&&GPAuth(" + JSONObject.quote(c) + ")", null));
  }

  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    readAuthIntent(intent);
  }

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    readAuthIntent(getIntent());

    SharedPreferences prefs = getSharedPreferences("gp", MODE_PRIVATE);
    fullscreen = prefs.getBoolean("fullscreen", true);

    Window window = getWindow();
    // O app desenha por trás das barras e do recorte da câmera, sem faixa branca em volta.
    WindowCompat.setDecorFitsSystemWindows(window, false);
    window.setBackgroundDrawable(new ColorDrawable(BG));
    window.setStatusBarColor(Color.TRANSPARENT);
    window.setNavigationBarColor(Color.TRANSPARENT);
    if (Build.VERSION.SDK_INT >= 28) {
      WindowManager.LayoutParams lp = window.getAttributes();
      lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
      window.setAttributes(lp);
    }

    // Avisa o app web quanto espaço evitar (variáveis CSS --sat, --sar, --sab, --sal).
    ViewCompat.setOnApplyWindowInsetsListener(window.getDecorView(), (v, insets) -> {
      applyIme(insets);
      pushInsets(insets);
      return ViewCompat.onApplyWindowInsets(v, insets);
    });

    WebView web = getBridge().getWebView();
    if (web != null) {
      web.setBackgroundColor(BG);
      web.addJavascriptInterface(new Native(), "GPNative");
    }

    // Cadeado do jogo: com ele fechado, o botão voltar do celular não faz nada.
    backLock = new OnBackPressedCallback(false) {
      @Override public void handleOnBackPressed() { /* travado */ }
    };
    getOnBackPressedDispatcher().addCallback(this, backLock);

    setOrientation("portrait");
    applyFullscreen();

    new File(getCacheDir(), "update.apk").delete();
    ContextCompat.registerReceiver(this, installReceiver, new IntentFilter(ACT_INSTALL), ContextCompat.RECEIVER_NOT_EXPORTED);
  }

  @Override
  public void onDestroy() {
    try { unregisterReceiver(installReceiver); } catch (Exception ignored) { }
    super.onDestroy();
  }

  /** Avisa o app web (window.GPUpd) sobre o andamento da atualização. */
  private void js(final String st, final String v) {
    runOnUiThread(() -> {
      WebView web = getBridge() != null ? getBridge().getWebView() : null;
      if (web != null) {
        web.evaluateJavascript("window.GPUpd&&GPUpd(" + JSONObject.quote(st) + "," + JSONObject.quote(v) + ")", null);
      }
    });
  }

  private void downloadAndInstall(String url) throws Exception {
    downloadAndInstall(url, null, 0);
  }

  /** Baixa o APK; se vier o SHA-256 esperado, só instala se o arquivo bater (senão avisa 'sha'). */
  private void downloadAndInstall(String url, String sha, long size) throws Exception {
    File f = new File(getCacheDir(), "update.apk");
    HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
    c.setConnectTimeout(15000);
    c.setReadTimeout(30000);
    c.setInstanceFollowRedirects(true);
    c.setRequestProperty("User-Agent", "GamePlatform");
    int code = c.getResponseCode();
    if (code != 200) throw new IOException("Servidor respondeu " + code);
    long total = c.getContentLengthLong();
    try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(f)) {
      byte[] buf = new byte[65536];
      long done = 0;
      int n, last = -1;
      while ((n = in.read(buf)) > 0) {
        out.write(buf, 0, n);
        done += n;
        if (total > 0) {
          int p = (int) (done * 100 / total);
          if (p != last) { last = p; js("dl", String.valueOf(p)); }
        }
      }
    }
    if (f.length() < 1_000_000) throw new IOException("Arquivo incompleto");
    if (size > 0 && f.length() != size) {
      f.delete();
      updating = false;
      js("sha", "tamanho");
      return;
    }
    if (sha != null && sha.length() > 0) {
      MessageDigest md = MessageDigest.getInstance("SHA-256");
      try (InputStream in = new FileInputStream(f)) {
        byte[] b = new byte[65536];
        int n;
        while ((n = in.read(b)) > 0) md.update(b, 0, n);
      }
      StringBuilder hex = new StringBuilder();
      for (byte x : md.digest()) hex.append(String.format("%02x", x));
      if (!hex.toString().equalsIgnoreCase(sha.trim())) {
        f.delete();
        updating = false;
        js("sha", "hash");
        return;
      }
    }
    js("inst", "");

    PackageInstaller pi = getPackageManager().getPackageInstaller();
    PackageInstaller.SessionParams sp = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
    // Android 12+: permite instalar a atualização sem perguntar quando o próprio app a instala.
    if (Build.VERSION.SDK_INT >= 31) sp.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
    int id = pi.createSession(sp);
    try (PackageInstaller.Session s = pi.openSession(id)) {
      try (InputStream in = new FileInputStream(f); OutputStream out = s.openWrite("gp.apk", 0, f.length())) {
        byte[] buf = new byte[65536];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        s.fsync(out);
      }
      Intent it = new Intent(ACT_INSTALL).setPackage(getPackageName());
      int fl = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
      s.commit(PendingIntent.getBroadcast(this, id, it, fl).getIntentSender());
    }
  }

  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    if (hasFocus && fullscreen) {
      applyFullscreen();
    }
  }

  private void applyFullscreen() {
    WindowInsetsControllerCompat controller =
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
    if (controller == null) return;
    controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    if (fullscreen) {
      controller.hide(WindowInsetsCompat.Type.systemBars());
    } else {
      controller.show(WindowInsetsCompat.Type.systemBars());
    }
    getWindow().getDecorView().requestApplyInsets();
  }

  private void setOrientation(String mode) {
    int value;
    if ("landscape".equals(mode)) {
      value = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE;   // as duas posições deitadas
    } else if ("auto".equals(mode)) {
      value = ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR;        // o jogador gira como quiser
    } else {
      value = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT;           // em pé, sem girar
    }
    setRequestedOrientation(value);
  }

  // Com o app desenhando por trás das barras o teclado não encolhe a tela sozinho: a área do WebView
  // passa a terminar no topo do teclado, e o app (que reage ao tamanho da janela) continua inteiro na tela.
  private void applyIme(WindowInsetsCompat insets) {
    try {
      WebView web = getBridge() != null ? getBridge().getWebView() : null;
      if (web == null) return;
      int bottom = insets.isVisible(WindowInsetsCompat.Type.ime())
          ? insets.getInsets(WindowInsetsCompat.Type.ime()).bottom : 0;
      android.view.ViewGroup.LayoutParams lp = web.getLayoutParams();
      if (lp instanceof android.view.ViewGroup.MarginLayoutParams) {
        android.view.ViewGroup.MarginLayoutParams m = (android.view.ViewGroup.MarginLayoutParams) lp;
        if (m.bottomMargin != bottom) {
          m.bottomMargin = bottom;
          web.setLayoutParams(m);
        }
      }
    } catch (Exception ignored) {
      // sem ajuste de teclado: o app web ainda tenta se ajustar sozinho
    }
  }

  private void pushInsets(WindowInsetsCompat insets) {
    WebView web = getBridge() != null ? getBridge().getWebView() : null;
    if (web == null) return;
    // Com as barras escondidas só o recorte da câmera importa; com elas visíveis, as barras também.
    int types = WindowInsetsCompat.Type.displayCutout();
    if (!fullscreen) types |= WindowInsetsCompat.Type.systemBars();
    Insets i = insets.getInsets(types);
    boolean imeOn = insets.isVisible(WindowInsetsCompat.Type.ime());
    float d = getResources().getDisplayMetrics().density;
    String js = "(function(s){s.setProperty('--sat','" + (i.top / d) + "px');"
        + "s.setProperty('--sar','" + (i.right / d) + "px');"
        + "s.setProperty('--sab','" + ((imeOn ? 0 : i.bottom) / d) + "px');"
        + "s.setProperty('--sal','" + (i.left / d) + "px');})(document.documentElement.style)";
    web.evaluateJavascript(js, null);
  }

  private long versionCode() {
    try {
      android.content.pm.PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
      return Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode;
    } catch (Exception e) {
      return 0;
    }
  }


  // ---------- Pastas dos jogos: GamePlatform/<nome do jogo>/ ----------
  private static final long GAME_FILE_MAX = 50L * 1024 * 1024;
  private static final long GAME_DIR_MAX = 300L * 1024 * 1024;

  private File gamesRoot() {
    File b = getExternalFilesDir(null);
    if (b == null) b = getFilesDir();
    File r = new File(b, "GamePlatform");
    if (!r.exists()) r.mkdirs();
    return r;
  }

  private static String cleanGameName(String s) {
    if (s == null) return "";
    String c = s.replaceAll("[^\\p{L}\\p{N} _.()-]", "").trim();
    while (c.startsWith(".")) c = c.substring(1);
    if (c.length() > 60) c = c.substring(0, 60).trim();
    return c;
  }

  /** Resolve um arquivo dentro da pasta do jogo e recusa qualquer caminho que escape dela. */
  private File gameFile(String game, String rel, boolean create) throws IOException {
    String g = cleanGameName(game);
    if (g.isEmpty()) throw new IOException("nome do jogo invalido");
    File dir = new File(gamesRoot(), g);
    if (create && !dir.exists()) dir.mkdirs();
    String r = rel == null ? "" : rel.trim();
    if (!r.isEmpty()) {
      if (r.length() > 200 || r.startsWith("/") || r.contains("\\") || !r.matches("[\\p{L}\\p{N} _.()/-]+")) throw new IOException("caminho invalido");
      for (String part : r.split("/")) if (part.equals("..") || part.equals(".") || part.isEmpty()) throw new IOException("caminho invalido");
    }
    File f = r.isEmpty() ? dir : new File(dir, r);
    String base = dir.getCanonicalPath() + File.separator;
    if (!(f.getCanonicalPath() + File.separator).startsWith(base)) throw new IOException("caminho invalido");
    return f;
  }

  private static long dirSize(File f) {
    if (f == null || !f.exists()) return 0;
    if (f.isFile()) return f.length();
    long t = 0;
    File[] l = f.listFiles();
    if (l != null) for (File x : l) t += dirSize(x);
    return t;
  }

  private static int fileCount(File f) {
    if (f == null || !f.exists()) return 0;
    if (f.isFile()) return 1;
    int t = 0;
    File[] l = f.listFiles();
    if (l != null) for (File x : l) t += fileCount(x);
    return t;
  }

  private static boolean deleteAll(File f) {
    if (f.isDirectory()) {
      File[] l = f.listFiles();
      if (l != null) for (File x : l) deleteAll(x);
    }
    return f.delete();
  }

  private static byte[] readAll(InputStream in, long max) throws IOException {
    ByteArrayOutputStream o = new ByteArrayOutputStream();
    byte[] b = new byte[16384];
    int n;
    long t = 0;
    while ((n = in.read(b)) > 0) {
      t += n;
      if (t > max) throw new IOException("arquivo grande demais");
      o.write(b, 0, n);
    }
    return o.toByteArray();
  }

  private void fileCallback(final String id, final boolean ok, final String msg) {
    runOnUiThread(() -> {
      WebView web = getBridge() != null ? getBridge().getWebView() : null;
      if (web != null) web.evaluateJavascript("window.GPFile&&GPFile(" + JSONObject.quote(id) + "," + ok + "," + JSONObject.quote(msg == null ? "" : msg) + ")", null);
    });
  }

  /** Ponte chamada pelo app web (window.GPNative). */
  private class Native {
    @JavascriptInterface
    public String takeAuth() {
      String c = pendingAuth;
      pendingAuth = null;
      return c == null ? "" : c;
    }


    // ----- arquivos dos jogos (cada jogo só enxerga a própria pasta) -----
    @JavascriptInterface
    public String gamesPath() {
      try { return gamesRoot().getAbsolutePath(); } catch (Exception e) { return ""; }
    }

    @JavascriptInterface
    public String gameWrite(String game, String rel, String data, boolean b64) {
      try {
        byte[] bytes = b64 ? Base64.decode(data == null ? "" : data, Base64.DEFAULT) : (data == null ? "" : data).getBytes("UTF-8");
        if (bytes.length > GAME_FILE_MAX) return "err:arquivo grande demais (maximo 50 MB)";
        File f = gameFile(game, rel, true);
        if (f.isDirectory()) return "err:e uma pasta";
        long used = dirSize(gameFile(game, "", true)) - (f.exists() ? f.length() : 0);
        if (used + bytes.length > GAME_DIR_MAX) return "err:pasta do jogo cheia (maximo 300 MB)";
        File par = f.getParentFile();
        if (par != null && !par.exists()) par.mkdirs();
        File tmp = new File(f.getPath() + ".tmp");
        FileOutputStream o = new FileOutputStream(tmp);
        try { o.write(bytes); o.getFD().sync(); } finally { o.close(); }
        if (f.exists() && !f.delete()) return "err:nao foi possivel gravar";
        if (!tmp.renameTo(f)) return "err:nao foi possivel gravar";
        return "ok";
      } catch (Exception e) {
        return "err:" + (e.getMessage() == null ? "falha" : e.getMessage());
      }
    }

    /** Devolve o conteúdo (texto ou base64) ou null se o arquivo não existe. */
    @JavascriptInterface
    public String gameRead(String game, String rel, boolean b64) {
      try {
        File f = gameFile(game, rel, false);
        if (!f.isFile()) return null;
        InputStream in = new FileInputStream(f);
        try {
          byte[] bytes = readAll(in, 30L * 1024 * 1024);
          return b64 ? Base64.encodeToString(bytes, Base64.NO_WRAP) : new String(bytes, "UTF-8");
        } finally { in.close(); }
      } catch (Exception e) {
        return null;
      }
    }

    @JavascriptInterface
    public String gameList(String game, String rel) {
      JSONArray a = new JSONArray();
      try {
        File d = gameFile(game, rel, false);
        File[] l = d.isDirectory() ? d.listFiles() : null;
        if (l != null) for (File x : l) {
          if (x.getName().endsWith(".tmp")) continue;
          JSONObject o = new JSONObject();
          o.put("n", x.getName());
          o.put("d", x.isDirectory());
          o.put("s", x.isDirectory() ? dirSize(x) : x.length());
          o.put("t", x.lastModified());
          a.put(o);
        }
      } catch (Exception ignored) { }
      return a.toString();
    }

    /** rel vazio apaga a pasta inteira do jogo. */
    @JavascriptInterface
    public boolean gameRemove(String game, String rel) {
      try {
        File f = gameFile(game, rel, false);
        return !f.exists() || deleteAll(f);
      } catch (Exception e) {
        return false;
      }
    }

    @JavascriptInterface
    public String gamesIndex() {
      JSONArray a = new JSONArray();
      try {
        File[] l = gamesRoot().listFiles();
        if (l != null) for (File x : l) {
          if (!x.isDirectory()) continue;
          JSONObject o = new JSONObject();
          o.put("n", x.getName());
          o.put("s", dirSize(x));
          o.put("c", fileCount(x));
          o.put("t", x.lastModified());
          a.put(o);
        }
      } catch (Exception ignored) { }
      return a.toString();
    }

    /** Baixa um arquivo (https) direto para a pasta do jogo. O resultado volta por GPFile(id, ok, mensagem). */
    @JavascriptInterface
    public void gameDownload(final String game, final String rel, final String url, final String id) {
      if (url == null || !url.startsWith("https://") || id == null) { fileCallback(String.valueOf(id), false, "so https"); return; }
      new Thread(() -> {
        File tmp = null;
        try {
          File f = gameFile(game, rel, true);
          if (f.isDirectory()) throw new IOException("e uma pasta");
          File par = f.getParentFile();
          if (par != null && !par.exists()) par.mkdirs();
          tmp = new File(f.getPath() + ".tmp");
          HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
          c.setConnectTimeout(15000);
          c.setReadTimeout(30000);
          c.setInstanceFollowRedirects(true);
          if (c.getResponseCode() != 200) throw new IOException("servidor respondeu " + c.getResponseCode());
          long used = dirSize(gameFile(game, "", true)) - (f.exists() ? f.length() : 0);
          long total = 0;
          InputStream in = c.getInputStream();
          FileOutputStream o = new FileOutputStream(tmp);
          try {
            byte[] b = new byte[32768];
            int n;
            while ((n = in.read(b)) > 0) {
              total += n;
              if (total > 100L * 1024 * 1024 || used + total > GAME_DIR_MAX) throw new IOException("limite de tamanho");
              o.write(b, 0, n);
            }
            o.getFD().sync();
          } finally { o.close(); in.close(); }
          if (f.exists() && !f.delete()) throw new IOException("nao foi possivel gravar");
          if (!tmp.renameTo(f)) throw new IOException("nao foi possivel gravar");
          fileCallback(id, true, String.valueOf(total));
        } catch (Exception e) {
          if (tmp != null) tmp.delete();
          fileCallback(id, false, e.getMessage() == null ? "falha no download" : e.getMessage());
        }
      }).start();
    }

    /** SHA-256 do certificado que assinou este app (igual ao "SHA256" do keytool). */
    @JavascriptInterface
    public String getSignature() {
      try {
        android.content.pm.Signature[] sg;
        boolean multi = false;
        if (Build.VERSION.SDK_INT >= 28) {
          android.content.pm.SigningInfo si = getPackageManager().getPackageInfo(getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES).signingInfo;
          if (si == null) sg = null; else { multi = si.hasMultipleSigners(); sg = multi ? si.getApkContentsSigners() : si.getSigningCertificateHistory(); }
        } else {
          sg = getPackageManager().getPackageInfo(getPackageName(), PackageManager.GET_SIGNATURES).signatures;
        }
        if (sg == null || sg.length == 0) return "";
        byte[] d = MessageDigest.getInstance("SHA-256").digest(sg[multi ? 0 : sg.length - 1].toByteArray());
        StringBuilder b = new StringBuilder();
        for (byte x : d) b.append(String.format("%02X", x));
        return b.toString();
      } catch (Exception e) {
        return "";
      }
    }

    @JavascriptInterface
    public String getBuild() {
      return String.valueOf(versionCode());
    }

    /** O Android só deixa o app instalar quando o usuário liberou "instalar apps desta fonte". */
    @JavascriptInterface
    public boolean canInstall() {
      return Build.VERSION.SDK_INT < 26 || getPackageManager().canRequestPackageInstalls();
    }

    @JavascriptInterface
    public void openInstallSettings() {
      runOnUiThread(() -> {
        try {
          Intent it = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName()));
          startActivity(it);
        } catch (Exception ignored) {
        }
      });
    }

    /** Baixa o APK e instala por cima, sem tirar o app do lugar. */
    @JavascriptInterface
    public void installApk(final String url) {
      if (url == null || !url.startsWith("https://") || updating) return;
      updating = true;
      new Thread(() -> {
        try {
          downloadAndInstall(url);
        } catch (Exception e) {
          updating = false;
          js("err", e.getMessage() == null ? "Falha no download" : e.getMessage());
        }
      }).start();
    }

    /** Igual a installApk, mas confere tamanho e SHA-256 publicados pelo servidor antes de instalar. */
    @JavascriptInterface
    public void installApkVerified(final String url, final String sha, final double size) {
      if (url == null || !url.startsWith("https://") || updating) return;
      if (sha != null && sha.length() > 0 && !sha.matches("[A-Fa-f0-9]{64}")) { js("sha", "formato"); return; }
      updating = true;
      new Thread(() -> {
        try {
          downloadAndInstall(url, sha, (long) size);
        } catch (Exception e) {
          updating = false;
          js("err", e.getMessage() == null ? "Falha no download" : e.getMessage());
        }
      }).start();
    }

    /** Pacote da loja que instalou o app (com.android.vending = Google Play). Vazio se foi por APK. */
    @JavascriptInterface
    public String getInstaller() {
      try {
        String p;
        if (Build.VERSION.SDK_INT >= 30) p = getPackageManager().getInstallSourceInfo(getPackageName()).getInstallingPackageName();
        else p = getPackageManager().getInstallerPackageName(getPackageName());
        return p == null ? "" : p;
      } catch (Exception e) {
        return "";
      }
    }

    /** Abre a página do app na Play Store (a atualização acontece pela loja). */
    @JavascriptInterface
    public void openStore() {
      runOnUiThread(() -> {
        try {
          startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + getPackageName())).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (Exception e) {
          try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=" + getPackageName())));
          } catch (Exception ignored) { }
        }
      });
    }

    @JavascriptInterface
    public void openUrl(final String url) {
      if (url == null || !url.startsWith("https://")) return;
      runOnUiThread(() -> {
        try {
          startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (Exception ignored) {
        }
      });
    }

    @JavascriptInterface
    public void setBackLock(final boolean on) {
      runOnUiThread(() -> backLock.setEnabled(on));
    }

    @JavascriptInterface
    public void setFullscreen(final boolean on) {
      runOnUiThread(() -> {
        fullscreen = on;
        getSharedPreferences("gp", MODE_PRIVATE).edit().putBoolean("fullscreen", on).apply();
        applyFullscreen();
      });
    }

    @JavascriptInterface
    public void setOrientation(final String mode) {
      runOnUiThread(() -> MainActivity.this.setOrientation(mode));
    }
  }
}
