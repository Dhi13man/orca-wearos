package expo.modules.orcawear

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.text.InputFilter
import android.text.InputType
import android.view.Gravity
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView

class WearTextEntryActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val label = intent.getStringExtra("label") ?: "Enter text"
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(36.dp, 28.dp, 36.dp, 28.dp)
            setBackgroundColor(Color.BLACK)
        }
        val title = TextView(this).apply {
            text = label
            textSize = 18f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        }
        val input = EditText(this).apply {
            contentDescription = "Wear text value"
            setSingleLine(true)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
            imeOptions = EditorInfo.IME_ACTION_DONE
            filters = arrayOf(InputFilter.LengthFilter(if (label == "Watch pairing code") 32 else 256))
            setTextColor(Color.WHITE)
            setHintTextColor(Color.LTGRAY)
            hint = label
        }
        val submit = {
            setResult(RESULT_OK, Intent().putExtra("text", input.text.toString()))
            finish()
        }
        input.setOnEditorActionListener { _, action, _ ->
            if (action == EditorInfo.IME_ACTION_DONE) {
                submit()
                true
            } else false
        }
        val button = Button(this).apply {
            text = "Use text"
            contentDescription = "Use text"
            setOnClickListener { submit() }
        }
        root.addView(title)
        root.addView(input, LinearLayout.LayoutParams(-1, -2))
        root.addView(button, LinearLayout.LayoutParams(-1, -2))
        setContentView(root)
    }

    private val Int.dp: Int get() = (this * resources.displayMetrics.density).toInt()
}
