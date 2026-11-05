# Genera frases de prueba en WAV con una voz de Windows (API WinRT, Windows 10/11).
# Requiere una voz del idioma pedido: Configuración → Hora e idioma → Voz → Agregar voces.
# Uso: powershell -ExecutionPolicy Bypass -File tools/make-test-audio.ps1 [-Language es]
param(
  [string]$Language = "es",
  [string]$OutDir = (Join-Path $PSScriptRoot "..\tests\audio")
)
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]

$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq "AsTask" -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq "IAsyncOperation``1"
} | Select-Object -First 1

function Await($op, [Type]$resultType) {
  $task = $asTask.MakeGenericMethod($resultType).Invoke($null, @($op))
  $task.Wait() | Out-Null
  return $task.Result
}

$synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
$voice = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.Language -like "$Language*" } | Select-Object -First 1
if (-not $voice) {
  $available = ([Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | ForEach-Object { "$($_.DisplayName) ($($_.Language))" }) -join ", "
  throw "No hay ninguna voz '$Language' instalada. Voces disponibles: $available"
}
$synth.Voice = $voice
Write-Host "Voz: $($voice.DisplayName) ($($voice.Language))"

$phrases = @{
  es = @(
    "Hola, esto es una prueba de dictado por voz.",
    "Mañana a las diez tenemos la reunión del proyecto, no te olvides.",
    "¿Puedes enviarme el informe antes del viernes? Gracias."
  )
  en = @(
    "Hello, this is a voice dictation test.",
    "Please send me the report before Friday."
  )
}
$list = $phrases[$Language.Substring(0, 2)]
if (-not $list) { $list = $phrases["es"] }

New-Item -ItemType Directory -Force $OutDir | Out-Null
$i = 0
foreach ($text in $list) {
  $i++
  $stream = Await ($synth.SynthesizeTextToStreamAsync($text)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
  $reader = New-Object Windows.Storage.Streams.DataReader($stream.GetInputStreamAt(0))
  $size = [uint32]$stream.Size
  $null = Await ($reader.LoadAsync($size)) ([uint32])
  $bytes = New-Object byte[] $size
  $reader.ReadBytes($bytes)
  $file = Join-Path $OutDir ("frase-{0}-{1}.wav" -f $Language, $i)
  [IO.File]::WriteAllBytes($file, $bytes)
  [IO.File]::WriteAllText("$file.txt", $text, (New-Object Text.UTF8Encoding $false))
  Write-Host "  $file"
}
