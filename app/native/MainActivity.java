package com.gameplatform.app;

import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.os.Build;
import android.os.Bundle;
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
 * Tela cheia automática e controle de orientação para o Game Platform.
 * O app web chama window.GPNative.setFullscreen(boolean) e window.GPNative.setOrientation("auto" | "portrait" | "landscape").
 * Este arquivo substitui o MainActivity gerado pelo Capacitor (veja .github/workflows/build-apk.yml).
 */
public class MainActivity extends BridgeActivity {
  private boolean fullscreen = true;
  private String orientation = "auto";

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    SharedPreferences prefs = getSharedPreferences("gp", MODE_PRIVATE);
    fullscreen = prefs.getBoolean("fullscreen", true);
    orientation = prefs.getString("orientation", "auto");

    // Usa também a área do recorte da câmera (notch) nas bordas curtas da tela.
    if (Build.VERSION.SDK_INT >= 28) {
      WindowManager.LayoutParams lp = getWindow().getAttributes();
      lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
      getWindow().setAttributes(lp);
    }

    // Avisa o app web quanto espaço do recorte deve ser evitado (variáveis CSS --sat, --sar, --sab, --sal).
    ViewCompat.setOnApplyWindowInsetsListener(getWindow().getDecorView(), (v, insets) -> {
      pushInsets(insets);
      return ViewCompat.onApplyWindowInsets(v, insets);
    });

    WebView web = getBridge().getWebView();
    if (web != null) {
      web.addJavascriptInterface(new Native(), "GPNative");
    }

    applyOrientation();
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

  private void applyOrientation() {
    int mode;
    switch (orientation) {
      case "portrait":
        mode = ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT;
        break;
      case "landscape":
        mode = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE;
        break;
      default:
        mode = ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR;
    }
    setRequestedOrientation(mode);
  }

  private void pushInsets(WindowInsetsCompat insets) {
    WebView web = getBridge() != null ? getBridge().getWebView() : null;
    if (web == null) return;
    // Com as barras do sistema visíveis, o Android já posiciona o app abaixo delas.
    // Só quando elas estão escondidas é preciso evitar o recorte da câmera.
    Insets i = fullscreen ? insets.getInsets(WindowInsetsCompat.Type.displayCutout()) : Insets.NONE;
    float d = getResources().getDisplayMetrics().density;
    String js = "(function(s){s.setProperty('--sat','" + (i.top / d) + "px');"
        + "s.setProperty('--sar','" + (i.right / d) + "px');"
        + "s.setProperty('--sab','" + (i.bottom / d) + "px');"
        + "s.setProperty('--sal','" + (i.left / d) + "px');})(document.documentElement.style)";
    web.evaluateJavascript(js, null);
  }

  /** Ponte chamada pelo app web (window.GPNative). */
  private class Native {
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
      runOnUiThread(() -> {
        orientation = ("portrait".equals(mode) || "landscape".equals(mode)) ? mode : "auto";
        getSharedPreferences("gp", MODE_PRIVATE).edit().putString("orientation", orientation).apply();
        applyOrientation();
      });
    }
  }
}
