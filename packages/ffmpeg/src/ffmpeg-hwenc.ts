import { Systeminformation, graphics } from 'systeminformation'

enum FFmpegAccelKind {
  Intel = "Intel",
  AMD = "AMD",
  NVIDIA = "NVIDIA",
  None = "None",
}

interface FFmpegAccelDevice {
  kind: FFmpegAccelKind
  busAddress: string
}

function deviceFromController(gfxController: Systeminformation.GraphicsControllerData): FFmpegAccelDevice {
  var accelDevice: FFmpegAccelDevice

  Object.values(FFmpegAccelKind).forEach((accelKind) => {
    const match = gfxController.vendor.includes(accelKind)

    if (!match) {
      return
    }

    accelDevice = { kind: accelKind, busAddress: gfxController.busAddress }
  })

  // var options = [
  //   { name: 'One', assigned: true },
  //   { name: 'Two', assigned: false },
  //   { name: 'Three', assigned: true },
  // ];

  // var reduced = options.reduce(function(filtered, option) {
  //   if (option.assigned) {
  //      var someNewValue = { name: option.name, newProperty: 'Foo' }
  //      filtered.push(someNewValue);
  //   }
  //   return filtered;
  // }, []);

  return accelDevice
}

async function getFFmpegAccelerators(): Promise<FFmpegAccelDevice[]> {
  const gfx = await graphics()
  const accelerators: Array<FFmpegAccelDevice> = gfx.controllers.map((gfx) => deviceFromController(gfx))

  // TODO: verify

  return accelerators
}

export {
  FFmpegAccelKind,
  getFFmpegAccelerators
}
