package com.gameplatform.app;

import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

/**
 * Tela cheia de ponta a ponta e controle de orientação para o Game Platform.
 *
 * O app web chama window.GPNative:
 *   setFullscreen(boolean)  esconde ou mostra as barras do sistema
 *   setOrientation("portrait" | "landscape" | "auto")  trava a tela em pé, deitada, ou deixa girar
 *   getBuild() / openUrl(url)  usados pela atualização do app
 *
 * Fora dos jogos o app fica em pé; ao abrir um jogo o app web pede a orientação do jogo.
 * Este arquivo substitui o MainActivity gerado pelo Capacitor (veja .github/workflows/build-apk.yml).
 */
public class MainActivity extends BridgeActivity {
  private static final int BG = 0xFF0A0D1C;
  private boolean fullscreen = true;

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

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
      pushInsets(insets);
      return ViewCompat.onApplyWindowInsets(v, insets);
    });

    WebView web = getBridge().getWebView();
    if (web != null) {
      web.setBackgroundColor(BG);
      web.addJavascriptInterface(new Native(), "GPNative");
    }

    setOrientation("portrait");
    applyFullscreen();
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

  private void pushInsets(WindowInsetsCompat insets) {
    WebView web = getBridge() != null ? getBridge().getWebView() : null;
    if (web == null) return;
    // Com as barras escondidas só o recorte da câmera importa; com elas visíveis, as barras também.
    int types = WindowInsetsCompat.Type.displayCutout();
    if (!fullscreen) types |= WindowInsetsCompat.Type.systemBars();
    Insets i = insets.getInsets(types);
    float d = getResources().getDisplayMetrics().density;
    String js = "(function(s){s.setProperty('--sat','" + (i.top / d) + "px');"
        + "s.setProperty('--sar','" + (i.right / d) + "px');"
        + "s.setProperty('--sab','" + (i.bottom / d) + "px');"
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

  /** Ponte chamada pelo app web (window.GPNative). */
  private class Native {
    @JavascriptInterface
    public String getBuild() {
      return String.valueOf(versionCode());
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
