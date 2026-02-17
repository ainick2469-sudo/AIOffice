$desktopPath = [Environment]::GetFolderPath('Desktop')
Write-Host "Desktop: $desktopPath"

$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("$desktopPath\AI Office.lnk")
$Shortcut.TargetPath = "C:\Users\nickb\AppData\Local\Programs\Python\Python312\python.exe"
$Shortcut.Arguments = "start.py"
$Shortcut.WorkingDirectory = "C:\AI_WORKSPACE\ai-office"
$Shortcut.IconLocation = "C:\Windows\System32\shell32.dll,137"
$Shortcut.Description = "Launch AI Office Desktop App"
$Shortcut.Save()
Write-Host "Done! AI Office shortcut created."
