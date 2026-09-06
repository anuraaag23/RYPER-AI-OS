package os.ryper.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text

/**
 * Entry point placeholder for the Android shell. Intentionally minimal —
 * proves out the Gradle module's shape and Compose wiring. The real shell
 * (Glass Dock, Voice Orb, Core IPC client) lands once this shell's
 * implementation phase begins, per the roadmap.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Surface {
                    Text("RYPER AI OS — Android shell scaffold.")
                }
            }
        }
    }
}
