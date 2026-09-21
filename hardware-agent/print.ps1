param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [string]$Printer,
    [int]$Copies = 1
)

$ErrorActionPreference = 'Stop'

if ($Copies -lt 1) { $Copies = 1 }
if ($Copies -gt 5) { $Copies = 5 }

for ($i = 0; $i -lt $Copies; $i++) {
    if ($Printer) {
        Start-Process -FilePath $Path -Verb PrintTo -ArgumentList $Printer -WindowStyle Hidden -Wait
    } else {
        Start-Process -FilePath $Path -Verb Print -WindowStyle Hidden -Wait
    }
}
