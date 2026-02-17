$shell = New-Object -ComObject Shell.Application
$desktopPath = $shell.Namespace('Desktop').Self.Path
Write-Host "Your actual desktop folder: $desktopPath"

$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("$desktopPath\AI Office.lnk")
$Shortcut.TargetPath = "C:\Users\nickb\AppData\Local\Programs\Python\Python312\python.exe"
$Shortcut.Arguments = "start.py"
$Shortcut.WorkingDirectory = "C:\AI_WORKSPACE\ai-office"
$Shortcut.IconLocation = "C:\Windows\System32\shell32.dll,137"
$Shortcut.Description = "Launch AI Office Desktop App"
$Shortcut.Save()
Write-Host "Shortcut placed at: $desktopPath\AI Office.lnk"
