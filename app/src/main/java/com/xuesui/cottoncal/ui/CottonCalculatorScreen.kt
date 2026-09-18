package com.xuesui.cottoncal.ui

import android.content.ActivityNotFoundException
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.provider.MediaStore
import android.widget.Toast
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.net.toUri
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.platform.testTag
import com.xuesui.cottoncal.R
import com.xuesui.cottoncal.model.CalculationResult
import com.xuesui.cottoncal.model.CottonPreset
import com.xuesui.cottoncal.model.InputField
import com.xuesui.cottoncal.model.PriceBasis
import com.xuesui.cottoncal.state.CalculatorViewModel
import com.xuesui.cottoncal.state.PresetUiState
import com.xuesui.cottoncal.ui.theme.CottonGreen
import com.xuesui.cottoncal.ui.theme.SeedBrown
import java.math.BigDecimal
import java.math.RoundingMode
import java.text.DecimalFormat

object TestTags {
    const val PRESET_HAND = "preset_hand"
    const val PRESET_MACHINE = "preset_machine"
    const val SEED_PRICE = "seed_price"
    const val LINT_PRICE = "lint_price"
    const val DETAILS_TOGGLE = "details_toggle"
    const val RESET = "reset"
    const val CONTACT_AUTHOR = "contact_author"
    const val AUTHOR_DIALOG = "author_dialog"
    const val AUTHOR_QR_CODE = "author_qr_code"
    fun field(field: InputField) = "field_${field.name.lowercase()}"
}

@Composable
fun CottonCalculatorApp(viewModel: CalculatorViewModel) {
    val uiState = viewModel.uiState
    CottonCalculatorScreen(
        selectedPreset = uiState.selectedPreset,
        state = uiState.current,
        showResetDialog = uiState.showResetDialog,
        onPresetSelected = viewModel::selectPreset,
        onValueChanged = viewModel::edit,
        onToggleDetails = viewModel::toggleDetails,
        onRequestReset = viewModel::requestReset,
        onCancelReset = viewModel::cancelReset,
        onConfirmReset = viewModel::confirmReset,
    )
}

@Composable
fun CottonCalculatorScreen(
    selectedPreset: CottonPreset,
    state: PresetUiState,
    showResetDialog: Boolean,
    onPresetSelected: (CottonPreset) -> Unit,
    onValueChanged: (InputField, String) -> Unit,
    onToggleDetails: () -> Unit,
    onRequestReset: () -> Unit,
    onCancelReset: () -> Unit,
    onConfirmReset: () -> Unit,
) {
    var showAuthorDialog by rememberSaveable { mutableStateOf(false) }

    Scaffold(
        modifier = Modifier.fillMaxSize(),
        containerColor = MaterialTheme.colorScheme.background,
    ) { scaffoldPadding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(scaffoldPadding)
                .safeDrawingPadding()
                .imePadding(),
            contentPadding = PaddingValues(horizontal = 18.dp, vertical = 18.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            item { Header(onContactAuthor = { showAuthorDialog = true }) }
            item {
                PresetSelector(
                    selected = selectedPreset,
                    onSelected = onPresetSelected,
                )
            }
            item {
                PriceBridge(
                    state = state,
                    onValueChanged = onValueChanged,
                )
            }
            item {
                ParameterCard(
                    state = state,
                    onValueChanged = onValueChanged,
                )
            }
            item {
                DetailCard(
                    state = state,
                    onToggleDetails = onToggleDetails,
                )
            }
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End,
                ) {
                    OutlinedButton(
                        onClick = onRequestReset,
                        modifier = Modifier.testTag(TestTags.RESET),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                    ) {
                        Text("恢复${selectedPreset.displayName}默认值")
                    }
                }
            }
            item { Spacer(Modifier.height(20.dp)) }
        }
    }

    if (showResetDialog) {
        AlertDialog(
            onDismissRequest = onCancelReset,
            title = { Text("恢复默认参数？") },
            text = { Text("这会覆盖当前${selectedPreset.displayName}的价格、参数和计算方向。") },
            confirmButton = {
                TextButton(onClick = onConfirmReset) { Text("恢复默认值") }
            },
            dismissButton = {
                TextButton(onClick = onCancelReset) { Text("取消") }
            },
        )
    }

    if (showAuthorDialog) {
        AuthorDialog(onDismiss = { showAuthorDialog = false })
    }
}

@Composable
private fun Header(onContactAuthor: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(42.dp)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.primary),
            contentAlignment = Alignment.Center,
        ) {
            Text("棉", color = MaterialTheme.colorScheme.onPrimary, fontWeight = FontWeight.Bold, fontSize = 19.sp)
        }
        Spacer(Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = "皮棉成本换算",
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.ExtraBold,
            )
            Text(
                text = "离线计算 · 数据只保存在本机",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        TextButton(
            onClick = onContactAuthor,
            modifier = Modifier.testTag(TestTags.CONTACT_AUTHOR),
            contentPadding = PaddingValues(horizontal = 8.dp, vertical = 8.dp),
        ) {
            Text("联系作者", fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun AuthorDialog(onDismiss: () -> Unit) {
    val context = LocalContext.current

    AlertDialog(
        modifier = Modifier.testTag(TestTags.AUTHOR_DIALOG),
        onDismissRequest = onDismiss,
        title = { Text("联系作者", fontWeight = FontWeight.ExtraBold) },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = 560.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(
                        "应用作者",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.primary,
                        fontWeight = FontWeight.Bold,
                    )
                    Text(
                        "厦门建发 · 赵泽帆",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                    )
                }
                ContactLink(
                    label = "电话",
                    value = "13212730826",
                    onClick = {
                        launchExternalIntent(
                            context,
                            Intent(Intent.ACTION_DIAL, "tel:13212730826".toUri()),
                            "未找到可用的拨号应用",
                        )
                    },
                )
                ContactLink(
                    label = "邮箱",
                    value = "zzf8640283@126.com",
                    onClick = {
                        launchExternalIntent(
                            context,
                            Intent(
                                Intent.ACTION_SENDTO,
                                "mailto:zzf8640283@126.com?subject=${Uri.encode("皮棉成本换算应用咨询")}".toUri(),
                            ),
                            "未找到可用的邮件应用",
                        )
                    },
                )
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                Text("微信", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                Image(
                    painter = painterResource(R.drawable.author_wechat_qr),
                    contentDescription = "赵泽帆的微信二维码，长按保存",
                    modifier = Modifier
                        .fillMaxWidth()
                        .aspectRatio(920f / 1401f)
                        .clip(RoundedCornerShape(16.dp))
                        .background(Color.White)
                        .combinedClickable(
                            onClick = {},
                            onLongClick = {
                                val saved = saveAuthorQrCode(context)
                                Toast.makeText(
                                    context,
                                    if (saved) "二维码已保存到相册" else "二维码保存失败，请稍后重试",
                                    Toast.LENGTH_SHORT,
                                ).show()
                            },
                        )
                        .testTag(TestTags.AUTHOR_QR_CODE),
                    contentScale = ContentScale.Fit,
                )
                Text(
                    "长按二维码保存到相册",
                    modifier = Modifier.fillMaxWidth(),
                    textAlign = TextAlign.Center,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text("关闭") }
        },
    )
}

@Composable
private fun ContactLink(label: String, value: String, onClick: () -> Unit) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .clickable(role = Role.Button, onClick = onClick),
        color = MaterialTheme.colorScheme.primaryContainer,
        shape = RoundedCornerShape(12.dp),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 11.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                label,
                modifier = Modifier.width(42.dp),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.7f),
            )
            Text(
                value,
                modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.primary,
                fontWeight = FontWeight.Bold,
            )
            Text("›", color = MaterialTheme.colorScheme.primary, fontSize = 22.sp)
        }
    }
}

private fun launchExternalIntent(context: Context, intent: Intent, unavailableMessage: String) {
    try {
        context.startActivity(intent)
    } catch (_: ActivityNotFoundException) {
        Toast.makeText(context, unavailableMessage, Toast.LENGTH_SHORT).show()
    }
}

private fun saveAuthorQrCode(context: Context): Boolean {
    val resolver = context.contentResolver
    val values = ContentValues().apply {
        put(MediaStore.Images.Media.DISPLAY_NAME, "微信二维码_赵泽帆_${System.currentTimeMillis()}.jpg")
        put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
        put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/皮棉成本换算")
        put(MediaStore.Images.Media.IS_PENDING, 1)
    }
    val imageUri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: return false

    return try {
        val bitmap = BitmapFactory.decodeResource(context.resources, R.drawable.author_wechat_qr)
        resolver.openOutputStream(imageUri)?.use { output ->
            check(bitmap.compress(Bitmap.CompressFormat.JPEG, 100, output))
        } ?: error("Unable to open image output stream")
        bitmap.recycle()
        values.clear()
        values.put(MediaStore.Images.Media.IS_PENDING, 0)
        resolver.update(imageUri, values, null, null)
        true
    } catch (_: Exception) {
        resolver.delete(imageUri, null, null)
        false
    }
}

@Composable
private fun PresetSelector(selected: CottonPreset, onSelected: (CottonPreset) -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .padding(4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        CottonPreset.entries.forEach { preset ->
            val isSelected = preset == selected
            Surface(
                modifier = Modifier
                    .weight(1f)
                    .testTag(if (preset == CottonPreset.HAND_PICKED) TestTags.PRESET_HAND else TestTags.PRESET_MACHINE)
                    .clickable(role = Role.RadioButton) { onSelected(preset) },
                color = if (isSelected) MaterialTheme.colorScheme.surface else Color.Transparent,
                shape = RoundedCornerShape(10.dp),
                tonalElevation = if (isSelected) 2.dp else 0.dp,
            ) {
                Text(
                    text = preset.displayName,
                    modifier = Modifier.padding(vertical = 11.dp),
                    textAlign = TextAlign.Center,
                    fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium,
                    color = if (isSelected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun PriceBridge(state: PresetUiState, onValueChanged: (InputField, String) -> Unit) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RoundedCornerShape(22.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("价格桥", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text(
                "最后实际修改的一侧作为计算依据",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                PriceInput(
                    modifier = Modifier.weight(1f),
                    label = "籽棉价",
                    unit = "元/kg",
                    value = state.seedCottonPrice,
                    isBasis = state.basis == PriceBasis.SEED_COTTON,
                    accent = CottonGreen,
                    error = state.errorFor(InputField.SEED_COTTON_PRICE),
                    testTag = TestTags.SEED_PRICE,
                    onValueChanged = { onValueChanged(InputField.SEED_COTTON_PRICE, it) },
                )
                Column(
                    modifier = Modifier.padding(horizontal = 8.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text("⇄", fontSize = 26.sp, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
                    Text("自动", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                PriceInput(
                    modifier = Modifier.weight(1f),
                    label = "皮棉价",
                    unit = "元/吨",
                    value = state.lintPrice,
                    isBasis = state.basis == PriceBasis.LINT,
                    accent = SeedBrown,
                    error = state.errorFor(InputField.LINT_PRICE),
                    testTag = TestTags.LINT_PRICE,
                    onValueChanged = { onValueChanged(InputField.LINT_PRICE, it) },
                )
            }
            val firstError = state.errors.firstOrNull()?.message
            if (firstError != null) {
                Text(
                    text = firstError,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }
        }
    }
}

@Composable
private fun PriceInput(
    modifier: Modifier,
    label: String,
    unit: String,
    value: String,
    isBasis: Boolean,
    accent: Color,
    error: String?,
    testTag: String,
    onValueChanged: (String) -> Unit,
) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Surface(
            color = if (isBasis) accent else MaterialTheme.colorScheme.surfaceVariant,
            contentColor = if (isBasis) Color.White else MaterialTheme.colorScheme.onSurfaceVariant,
            shape = RoundedCornerShape(50),
        ) {
            Text(
                text = if (isBasis) "计算依据" else "自动换算",
                modifier = Modifier.padding(horizontal = 9.dp, vertical = 4.dp),
                textAlign = TextAlign.Center,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Bold,
            )
        }
        OutlinedTextField(
            value = value,
            onValueChange = onValueChanged,
            modifier = Modifier.fillMaxWidth().testTag(testTag),
            label = { Text(label) },
            suffix = { Text(unit, fontSize = 10.sp) },
            textStyle = MaterialTheme.typography.titleMedium.copy(
                fontFamily = FontFamily.Monospace,
                fontWeight = FontWeight.Bold,
            ),
            singleLine = true,
            isError = error != null,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
        )
    }
}

@Composable
private fun ParameterCard(state: PresetUiState, onValueChanged: (InputField, String) -> Unit) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RoundedCornerShape(18.dp),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("计算参数", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            ParameterRow(
                state = state,
                left = ParameterSpec(InputField.LINT_PERCENTAGE, "衣分率", "%"),
                right = ParameterSpec(InputField.LOSS_PERCENTAGE, "损耗率", "%"),
                onValueChanged = onValueChanged,
            )
            ParameterRow(
                state = state,
                left = ParameterSpec(InputField.COTTONSEED_PRICE, "棉籽价格", "元/kg"),
                right = ParameterSpec(InputField.PROCESSING_FEE, "加工费", "元/吨"),
                onValueChanged = onValueChanged,
            )
            ParameterRow(
                state = state,
                left = ParameterSpec(InputField.LABOR_FEE, "人工费", "元/吨"),
                right = ParameterSpec(InputField.WAREHOUSE_FEE, "入库费", "元/吨"),
                onValueChanged = onValueChanged,
            )
            ParameterRow(
                state = state,
                left = ParameterSpec(InputField.FINANCE_FEE, "财务费", "元/吨"),
                right = ParameterSpec(InputField.SUBSIDY, "补贴（冲减）", "元/吨"),
                onValueChanged = onValueChanged,
            )
        }
    }
}

private data class ParameterSpec(val field: InputField, val label: String, val unit: String)

@Composable
private fun ParameterRow(
    state: PresetUiState,
    left: ParameterSpec,
    right: ParameterSpec,
    onValueChanged: (InputField, String) -> Unit,
) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        ParameterInput(
            modifier = Modifier.weight(1f),
            spec = left,
            value = state.value(left.field),
            error = state.errorFor(left.field),
            onValueChanged = { onValueChanged(left.field, it) },
        )
        ParameterInput(
            modifier = Modifier.weight(1f),
            spec = right,
            value = state.value(right.field),
            error = state.errorFor(right.field),
            onValueChanged = { onValueChanged(right.field, it) },
        )
    }
}

@Composable
private fun ParameterInput(
    modifier: Modifier,
    spec: ParameterSpec,
    value: String,
    error: String?,
    onValueChanged: (String) -> Unit,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChanged,
        modifier = modifier.testTag(TestTags.field(spec.field)),
        label = { Text(spec.label, maxLines = 1) },
        suffix = { Text(spec.unit, fontSize = 9.sp) },
        singleLine = true,
        isError = error != null,
        supportingText = if (error == null) null else ({ Text(error) }),
        textStyle = MaterialTheme.typography.bodyLarge.copy(fontFamily = FontFamily.Monospace),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
    )
}

@Composable
private fun DetailCard(state: PresetUiState, onToggleDetails: () -> Unit) {
    val interactionSource = remember { MutableInteractionSource() }
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .testTag(TestTags.DETAILS_TOGGLE)
            .clickable(
                interactionSource = interactionSource,
                indication = null,
                role = Role.Button,
                onClick = onToggleDetails,
            ),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
        shape = RoundedCornerShape(18.dp),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text("计算明细", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    Text(
                        if (state.result == null) "修正输入后显示" else "查看成本如何形成",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.72f),
                    )
                }
                Text(if (state.detailsExpanded) "收起 ↑" else "展开 ↓", fontWeight = FontWeight.Bold)
            }
            AnimatedVisibility(visible = state.detailsExpanded && state.result != null) {
                state.result?.let { result ->
                    Column(modifier = Modifier.padding(top = 14.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                        HorizontalDivider(color = MaterialTheme.colorScheme.primary.copy(alpha = 0.2f))
                        DetailRow("棉籽产出率", formatPercent(result.cottonseedYield))
                        DetailRow("棉籽抵扣", "${formatDecimal(result.cottonseedDeductionPerKg)} 元/kg")
                        DetailRow("扣除棉籽后的籽棉成本", "${formatDecimal(result.netSeedCostPerKg)} 元/kg")
                        DetailRow("皮棉原料成本", "${formatMoney(result.rawLintCostPerTon)} 元/吨")
                        DetailRow("费用净额", "${formatSignedMoney(result.netFeesPerTon)} 元/吨")
                        HorizontalDivider(color = MaterialTheme.colorScheme.primary.copy(alpha = 0.2f))
                        DetailRow("最终入库成本", "${formatInteger(result.lintPrice)} 元/吨", emphasized = true)
                    }
                }
            }
        }
    }
}

@Composable
private fun DetailRow(label: String, value: String, emphasized: Boolean = false) {
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(
            label,
            modifier = Modifier.weight(1f),
            style = if (emphasized) MaterialTheme.typography.bodyLarge else MaterialTheme.typography.bodyMedium,
            fontWeight = if (emphasized) FontWeight.Bold else FontWeight.Normal,
        )
        Text(
            value,
            fontFamily = FontFamily.Monospace,
            fontWeight = if (emphasized) FontWeight.ExtraBold else FontWeight.SemiBold,
            color = if (emphasized) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onPrimaryContainer,
        )
    }
}

private fun formatPercent(ratio: BigDecimal): String =
    "${ratio.multiply(BigDecimal("100")).stripTrailingZeros().toPlainString()}%"

private fun formatDecimal(value: BigDecimal): String =
    value.setScale(4, RoundingMode.HALF_UP).stripTrailingZeros().toPlainString()

private fun formatMoney(value: BigDecimal): String =
    DecimalFormat("#,##0.00").format(value.setScale(2, RoundingMode.HALF_UP))

private fun formatSignedMoney(value: BigDecimal): String {
    val formatted = formatMoney(value.abs())
    return if (value.signum() >= 0) "+$formatted" else "-$formatted"
}

private fun formatInteger(value: BigDecimal): String =
    DecimalFormat("#,##0").format(value.setScale(0, RoundingMode.HALF_UP))
