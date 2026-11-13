' Abre o DigitAI (é o alvo do atalho "DigitAI" na Área de Trabalho).
' Roda o Electron direto, em modo normal: o Electron não abre janela de console, e um modo
' "oculto" aqui faria o Windows criar o painel já minimizado.
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
appDir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = appDir
shell.Run """" & appDir & "\node_modules\electron\dist\electron.exe"" .", 1, False
